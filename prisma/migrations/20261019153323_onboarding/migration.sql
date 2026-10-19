-- CreateEnum
CREATE TYPE "AccreditationStatus" AS ENUM ('never_surveyed', 'accredited', 'conditional', 'not_accredited', 'expired');

-- AlterTable
ALTER TABLE "department" ADD COLUMN     "department_type" TEXT;

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "onboarded_at" TIMESTAMPTZ(6),
ADD COLUMN     "onboarding_steps" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "facility_framework" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_framework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element_applicability" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "applicable" BOOLEAN NOT NULL,
    "justification" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "element_applicability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_cycle" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "status" "AccreditationStatus" NOT NULL DEFAULT 'never_surveyed',
    "last_survey_on" DATE,
    "next_expected_on" DATE,
    "notes" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "survey_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facility_framework_tenant_id_facility_id_idx" ON "facility_framework"("tenant_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "facility_framework_facility_id_framework_id_key" ON "facility_framework"("facility_id", "framework_id");

-- CreateIndex
CREATE INDEX "element_applicability_tenant_id_facility_id_idx" ON "element_applicability"("tenant_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "element_applicability_facility_id_element_id_key" ON "element_applicability"("facility_id", "element_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_cycle_facility_id_key" ON "survey_cycle"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_cycle_tenant_id_facility_id_key" ON "survey_cycle"("tenant_id", "facility_id");

-- AddForeignKey
ALTER TABLE "facility" ADD CONSTRAINT "facility_type_fkey" FOREIGN KEY ("type") REFERENCES "facility_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_department_type_fkey" FOREIGN KEY ("department_type") REFERENCES "department_type"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_framework" ADD CONSTRAINT "facility_framework_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_framework" ADD CONSTRAINT "facility_framework_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_framework" ADD CONSTRAINT "facility_framework_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_applicability" ADD CONSTRAINT "element_applicability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_applicability" ADD CONSTRAINT "element_applicability_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_applicability" ADD CONSTRAINT "element_applicability_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_cycle" ADD CONSTRAINT "survey_cycle_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_cycle" ADD CONSTRAINT "survey_cycle_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for the onboarding tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facility_framework', 'element_applicability', 'survey_cycle'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

-- A facility may only mark an element "not applicable" with a reason a surveyor can read.
ALTER TABLE "element_applicability" ADD CONSTRAINT "element_applicability_na_justified"
  CHECK ("applicable" OR length(btrim(coalesce("justification", ''))) >= 10);

ALTER TABLE "survey_cycle" ADD CONSTRAINT "survey_cycle_dates_in_order"
  CHECK ("last_survey_on" IS NULL OR "next_expected_on" IS NULL OR "next_expected_on" > "last_survey_on");
