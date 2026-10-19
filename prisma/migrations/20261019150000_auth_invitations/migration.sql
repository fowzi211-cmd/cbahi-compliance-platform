-- M3: Better Auth tables, invitations, the auth database role and two narrow lookups.
-- See docs/ARCHITECTURE.md §5 and §6.

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "locked_until" TIMESTAMPTZ(6),
ADD COLUMN     "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_account" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "refresh_token_expires_at" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_verification" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_two_factor" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failed_verification_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),

    CONSTRAINT "auth_two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "department_id" UUID,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "token_hash" BYTEA NOT NULL,
    "invited_by" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_token_key" ON "auth_session"("token");

-- CreateIndex
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");

-- CreateIndex
CREATE INDEX "auth_account_user_id_idx" ON "auth_account"("user_id");

-- CreateIndex
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification"("identifier");

-- CreateIndex
CREATE INDEX "auth_two_factor_user_id_idx" ON "auth_two_factor"("user_id");

-- CreateIndex
CREATE INDEX "auth_two_factor_secret_idx" ON "auth_two_factor"("secret");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_tenant_id_facility_id_idx" ON "invitation"("tenant_id", "facility_id");

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invitations are tenant-owned like everything else.
-- ---------------------------------------------------------------------------
ALTER TABLE invitation ADD CONSTRAINT invitation_email_lowercase CHECK (email = lower(email));
-- At most one open invitation per person and facility role; re-inviting revokes the old one.
CREATE UNIQUE INDEX invitation_one_open_per_role ON invitation (tenant_id, facility_id, email, role)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitation
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- mustamir_auth: the role Better Auth connects with. It can reach the identity tables and
-- nothing else, and it is the only role besides the platform role that can read password
-- hashes, session tokens and TOTP secrets.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mustamir_auth') THEN
    CREATE ROLE mustamir_auth NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mustamir_auth;
GRANT SELECT, INSERT, UPDATE ON app_user TO mustamir_auth;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON auth_session, auth_account, auth_verification, auth_two_factor TO mustamir_auth;
REVOKE ALL ON auth_session, auth_account, auth_verification, auth_two_factor FROM mustamir_app;

-- Sign-in looks people up by email before any tenant is known.
CREATE POLICY auth_service ON app_user TO mustamir_auth USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Two cross-tenant lookups the app role needs before it knows the tenant. Each returns
-- only rows keyed by something the caller already proved: a verified session's user id,
-- or the secret invitation token. They run as mustamir_system, which bypasses RLS.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_user_memberships(p_user uuid)
  RETURNS TABLE (
    tenant_id uuid,
    facility_id uuid,
    department_id uuid,
    role "MembershipRole",
    facility_name_ar text,
    facility_name_en text
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT m.tenant_id, m.facility_id, m.department_id, m.role, f.name_ar, f.name_en
    FROM membership m
    JOIN facility f ON f.tenant_id = m.tenant_id AND f.id = m.facility_id
    WHERE m.user_id = p_user AND f.archived_at IS NULL
    ORDER BY m.created_at, m.id
  $$;

CREATE FUNCTION app_find_invitation(p_token_hash bytea)
  RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    facility_id uuid,
    email text,
    role "MembershipRole",
    locale text,
    facility_name_ar text,
    facility_name_en text,
    expires_at timestamptz,
    accepted_at timestamptz,
    revoked_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT i.id, i.tenant_id, i.facility_id, i.email, i.role, i.locale, f.name_ar, f.name_en,
           i.expires_at, i.accepted_at, i.revoked_at
    FROM invitation i
    JOIN facility f ON f.tenant_id = i.tenant_id AND f.id = i.facility_id
    WHERE i.token_hash = p_token_hash
  $$;

ALTER FUNCTION app_user_memberships(uuid) OWNER TO mustamir_system;
ALTER FUNCTION app_find_invitation(bytea) OWNER TO mustamir_system;
REVOKE ALL ON FUNCTION app_user_memberships(uuid), app_find_invitation(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_memberships(uuid), app_find_invitation(bytea) TO mustamir_app;
