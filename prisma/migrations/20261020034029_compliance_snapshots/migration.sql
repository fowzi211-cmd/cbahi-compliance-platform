-- CreateEnum
CREATE TYPE "ReadinessStatus" AS ENUM ('not_ready', 'at_risk', 'ready');

-- CreateTable
CREATE TABLE "compliance_snapshot" (
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "series" "ScoreSource" NOT NULL,
    "status" "ReadinessStatus" NOT NULL,
    "score" DECIMAL(6,5),
    "counted" INTEGER NOT NULL,
    "scored" INTEGER NOT NULL,
    "esr_not_met" INTEGER NOT NULL,
    "esr_unverified" INTEGER NOT NULL,
    "elements_expired" INTEGER NOT NULL,
    "overdue_capa" INTEGER NOT NULL,
    "chapters" JSONB NOT NULL,
    "departments" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_snapshot_pkey" PRIMARY KEY ("facility_id","framework_id","day","series")
);

-- CreateIndex
CREATE INDEX "compliance_snapshot_tenant_id_facility_id_day_idx" ON "compliance_snapshot"("tenant_id", "facility_id", "day");

-- AddForeignKey
ALTER TABLE "compliance_snapshot" ADD CONSTRAINT "compliance_snapshot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_snapshot" ADD CONSTRAINT "compliance_snapshot_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_snapshot" ADD CONSTRAINT "compliance_snapshot_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for snapshots.
-- ---------------------------------------------------------------------------

ALTER TABLE "compliance_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_snapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "compliance_snapshot"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "compliance_snapshot" ADD CONSTRAINT "compliance_snapshot_score"
  CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 1);
ALTER TABLE "compliance_snapshot" ADD CONSTRAINT "compliance_snapshot_counts" CHECK (
  "scored" BETWEEN 0 AND "counted" AND "esr_not_met" >= 0 AND "esr_unverified" >= 0
  AND "elements_expired" >= 0 AND "overdue_capa" >= 0);

-- The trend is historically honest: what the facility looked like on a day stays as it was
-- recorded, whatever is scored or corrected later.
CREATE FUNCTION compliance_snapshot_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'compliance snapshots cannot change' USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER compliance_snapshot_frozen BEFORE UPDATE ON "compliance_snapshot"
  FOR EACH ROW EXECUTE FUNCTION compliance_snapshot_frozen();
