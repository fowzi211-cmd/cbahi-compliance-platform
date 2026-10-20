-- CreateEnum
CREATE TYPE "ServiceRequestKind" AS ENUM ('mock_survey', 'consultation', 'gap_assessment');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('offered', 'open', 'in_progress', 'done', 'dismissed', 'cancelled');

-- CreateEnum
CREATE TYPE "ServiceRequestOrigin" AS ENUM ('user', 'struggle_signal');

-- CreateTable
CREATE TABLE "consultant_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by" UUID,

    CONSTRAINT "consultant_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "kind" "ServiceRequestKind",
    "status" "ServiceRequestStatus" NOT NULL,
    "origin" "ServiceRequestOrigin" NOT NULL,
    "signal_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "requested_by" UUID,
    "platform_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "service_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consultant_assignment_tenant_id_facility_id_idx" ON "consultant_assignment"("tenant_id", "facility_id");

-- CreateIndex
CREATE INDEX "consultant_assignment_user_id_idx" ON "consultant_assignment"("user_id");

-- CreateIndex
CREATE INDEX "service_request_tenant_id_facility_id_created_at_idx" ON "service_request"("tenant_id", "facility_id", "created_at");

-- CreateIndex
CREATE INDEX "service_request_status_idx" ON "service_request"("status");

-- CreateIndex
CREATE UNIQUE INDEX "service_request_tenant_id_id_key" ON "service_request"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "consultant_assignment" ADD CONSTRAINT "consultant_assignment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultant_assignment" ADD CONSTRAINT "consultant_assignment_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultant_assignment" ADD CONSTRAINT "consultant_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation, grants and integrity rules (ARCHITECTURE §3.2, §5).
-- ---------------------------------------------------------------------------

ALTER TABLE "consultant_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultant_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consultant_assignment"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "service_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_request" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_request"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Who may reach a tenant's data is the platform's decision, never the tenant's: the app can
-- read its consultant assignments but not write them. Requests are never deleted.
REVOKE INSERT, UPDATE, DELETE ON "consultant_assignment" FROM mustamir_app;
REVOKE DELETE ON "service_request" FROM mustamir_app;

-- One live assignment per consultant and facility.
CREATE UNIQUE INDEX "consultant_assignment_live" ON "consultant_assignment"("facility_id", "user_id")
  WHERE "ended_at" IS NULL;
ALTER TABLE "consultant_assignment" ADD CONSTRAINT "consultant_assignment_ended"
  CHECK ("ended_by" IS NULL OR "ended_at" IS NOT NULL);

-- A request names its kind once it is more than an unanswered offer; only the struggle
-- signal makes offers; closed requests carry when they closed.
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_kind"
  CHECK ("kind" IS NOT NULL OR "status" IN ('offered', 'dismissed'));
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_offer"
  CHECK ("status" <> 'offered' OR "origin" = 'struggle_signal');
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_closed"
  CHECK (("closed_at" IS NOT NULL) = ("status" IN ('done', 'dismissed', 'cancelled')));
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_text" CHECK (
  ("note" IS NULL OR char_length("note") <= 2000)
  AND ("platform_note" IS NULL OR char_length("platform_note") <= 2000));

-- The facilities a consultant may open, before the request knows its tenant: live
-- assignments, on a tenant whose subscription is Hybrid today (Riyadh), for an account that
-- still holds the consultant flag. Keyed by the verified session's user id, like
-- app_user_memberships.
CREATE FUNCTION app_consultant_facilities(p_user uuid)
  RETURNS TABLE (
    tenant_id uuid,
    facility_id uuid,
    facility_name_ar text,
    facility_name_en text
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT a.tenant_id, a.facility_id, f.name_ar, f.name_en
    FROM consultant_assignment a
    JOIN app_user u ON u.id = a.user_id AND u.is_platform_consultant
    JOIN facility f ON f.tenant_id = a.tenant_id AND f.id = a.facility_id
    JOIN subscription s ON s.tenant_id = a.tenant_id
    WHERE a.user_id = p_user AND a.ended_at IS NULL AND f.archived_at IS NULL
      AND s.tier = 'hybrid'
      AND s.starts_on <= (now() AT TIME ZONE 'Asia/Riyadh')::date
      AND (s.ends_on IS NULL OR s.ends_on >= (now() AT TIME ZONE 'Asia/Riyadh')::date)
    ORDER BY a.created_at, a.id
  $$;

ALTER FUNCTION app_consultant_facilities(uuid) OWNER TO mustamir_system;
REVOKE ALL ON FUNCTION app_consultant_facilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_consultant_facilities(uuid) TO mustamir_app;

-- A tenant sees the consultants who were given access to its facilities (assignment rows are
-- themselves filtered by RLS), so the owner can always tell who outside the staff can read
-- the facility's data.
CREATE POLICY consultant_of_current_tenant_read ON app_user FOR SELECT
  USING (EXISTS (SELECT 1 FROM consultant_assignment a WHERE a.user_id = app_user.id));
