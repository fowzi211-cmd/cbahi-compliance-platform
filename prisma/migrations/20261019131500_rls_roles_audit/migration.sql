-- Tenant isolation, database roles and the append-only audit log.
-- See docs/ARCHITECTURE.md §5 (multi-tenancy) and §6 (audit log).

-- ---------------------------------------------------------------------------
-- Roles. Created without LOGIN if missing so grants below always work; each
-- environment then gives them LOGIN and a password (locally: scripts/db/dev-roles.sql).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mustamir_app') THEN
    CREATE ROLE mustamir_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mustamir_system') THEN
    CREATE ROLE mustamir_system NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mustamir_app, mustamir_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mustamir_app, mustamir_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mustamir_app, mustamir_system;
-- Tables created by later migrations get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mustamir_app, mustamir_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mustamir_app, mustamir_system;

-- ---------------------------------------------------------------------------
-- Row-Level Security. The app sets `app.tenant_id` at the start of each transaction
-- (src/lib/db.ts, withTenant). When it is not set, NULLIF makes the comparison NULL
-- and no rows are visible or writable: a missing context fails closed.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscription', 'facility', 'department', 'membership'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

-- The tier is managed by the platform (M14), so tenants can read their subscription but
-- not change it. Only the system role, which bypasses RLS, writes it.
REVOKE INSERT, UPDATE, DELETE ON subscription FROM mustamir_app;

-- ---------------------------------------------------------------------------
-- Audit log: append-only, server-timestamped, hash-chained per tenant.
-- ---------------------------------------------------------------------------
ALTER TABLE audit_event ADD CONSTRAINT audit_event_chain_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, chain_seq);

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_event
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM mustamir_app, mustamir_system;

-- The exact text that is hashed. Keep in sync with nothing else: verification uses this
-- same function, so the format can only change through a new migration.
CREATE FUNCTION audit_event_payload(e audit_event) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT concat_ws('|',
      e.chain_seq::text,
      coalesce(e.tenant_id::text, ''),
      coalesce(e.actor_user_id::text, ''),
      e.action,
      e.entity,
      coalesce(e.entity_id, ''),
      coalesce(e.before::text, ''),
      coalesce(e.after::text, ''),
      coalesce(host(e.ip), ''),
      to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  $$;

CREATE FUNCTION audit_event_before_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  previous audit_event%ROWTYPE;
BEGIN
  -- Serialize writers per tenant so the chain has no forks.
  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(NEW.tenant_id::text, 'platform'), 42));

  SELECT * INTO previous FROM audit_event
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
    ORDER BY chain_seq DESC
    LIMIT 1;

  -- The server clock, never the caller's: evidence of when something happened cannot be
  -- backdated.
  NEW.at := clock_timestamp();
  NEW.chain_seq := coalesce(previous.chain_seq, 0) + 1;
  NEW.prev_hash := previous.hash;
  NEW.hash := sha256(coalesce(previous.hash, ''::bytea) || convert_to(audit_event_payload(NEW), 'UTF8'));
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_event_chain
  BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_before_insert();

CREATE FUNCTION audit_event_reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_event_immutable_rows
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_reject_change();

CREATE TRIGGER audit_event_immutable_table
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_reject_change();

-- Walks one tenant's chain (NULL = platform events) and reports the first broken link.
-- SECURITY INVOKER: under RLS the app can only verify its own tenant's chain.
CREATE FUNCTION audit_verify_chain(p_tenant uuid)
  RETURNS TABLE (ok boolean, checked bigint, first_broken_seq bigint)
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  e audit_event%ROWTYPE;
  expected_prev bytea := NULL;
  expected_seq bigint := 1;
  n bigint := 0;
BEGIN
  FOR e IN
    SELECT * FROM audit_event WHERE tenant_id IS NOT DISTINCT FROM p_tenant ORDER BY chain_seq
  LOOP
    n := n + 1;
    IF e.chain_seq <> expected_seq
       OR e.prev_hash IS DISTINCT FROM expected_prev
       OR e.hash IS DISTINCT FROM sha256(coalesce(e.prev_hash, ''::bytea) || convert_to(audit_event_payload(e), 'UTF8'))
    THEN
      RETURN QUERY SELECT false, n, e.chain_seq;
      RETURN;
    END IF;
    expected_prev := e.hash;
    expected_seq := expected_seq + 1;
  END LOOP;
  RETURN QUERY SELECT true, n, NULL::bigint;
END
$$;
