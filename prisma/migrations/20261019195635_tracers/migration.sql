-- CreateEnum
CREATE TYPE "TracerFrequency" AS ENUM ('weekly', 'monthly');

-- AlterTable
ALTER TABLE "assessment" ADD COLUMN     "assigned_to" UUID;

-- CreateTable
CREATE TABLE "assessment_element" (
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,

    CONSTRAINT "assessment_element_pkey" PRIMARY KEY ("assessment_id","element_id")
);

-- CreateTable
CREATE TABLE "tracer_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "department_id" UUID,
    "name_ar" TEXT,
    "name_en" TEXT,
    "sample_size" INTEGER NOT NULL,
    "frequency" "TracerFrequency" NOT NULL,
    "assignee_user_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "tracer_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracer_template_chapter" (
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,

    CONSTRAINT "tracer_template_chapter_pkey" PRIMARY KEY ("template_id","chapter_id")
);

-- CreateTable
CREATE TABLE "tracer_run" (
    "assessment_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "seed" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracer_run_pkey" PRIMARY KEY ("assessment_id")
);

-- CreateIndex
CREATE INDEX "assessment_element_tenant_id_assessment_id_idx" ON "assessment_element"("tenant_id", "assessment_id");

-- CreateIndex
CREATE INDEX "tracer_template_tenant_id_facility_id_idx" ON "tracer_template"("tenant_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracer_template_tenant_id_id_key" ON "tracer_template"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "tracer_template_chapter_tenant_id_template_id_idx" ON "tracer_template_chapter"("tenant_id", "template_id");

-- CreateIndex
CREATE INDEX "tracer_run_tenant_id_template_id_created_at_idx" ON "tracer_run"("tenant_id", "template_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tracer_run_tenant_id_assessment_id_key" ON "tracer_run"("tenant_id", "assessment_id");

-- AddForeignKey
ALTER TABLE "assessment_element" ADD CONSTRAINT "assessment_element_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_element" ADD CONSTRAINT "assessment_element_tenant_id_assessment_id_fkey" FOREIGN KEY ("tenant_id", "assessment_id") REFERENCES "assessment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_element" ADD CONSTRAINT "assessment_element_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_template" ADD CONSTRAINT "tracer_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_template" ADD CONSTRAINT "tracer_template_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_template" ADD CONSTRAINT "tracer_template_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_template" ADD CONSTRAINT "tracer_template_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_template_chapter" ADD CONSTRAINT "tracer_template_chapter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_template_chapter" ADD CONSTRAINT "tracer_template_chapter_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "tracer_template"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_template_chapter" ADD CONSTRAINT "tracer_template_chapter_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_run" ADD CONSTRAINT "tracer_run_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_run" ADD CONSTRAINT "tracer_run_tenant_id_assessment_id_fkey" FOREIGN KEY ("tenant_id", "assessment_id") REFERENCES "assessment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracer_run" ADD CONSTRAINT "tracer_run_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "tracer_template"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for tracers.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessment_element', 'tracer_template', 'tracer_template_chapter',
                           'tracer_run'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

ALTER TABLE "tracer_template" ADD CONSTRAINT "tracer_template_named" CHECK (
  length(btrim(coalesce("name_ar", ''))) > 0 OR length(btrim(coalesce("name_en", ''))) > 0);
ALTER TABLE "tracer_template" ADD CONSTRAINT "tracer_template_sample_size"
  CHECK ("sample_size" BETWEEN 1 AND 30);
ALTER TABLE "tracer_run" ADD CONSTRAINT "tracer_run_seed" CHECK ("seed" ~ '^[0-9a-f]{32}$');
ALTER TABLE "tracer_run" ADD CONSTRAINT "tracer_run_sample_size" CHECK ("sample_size" > 0);

-- Only a tracer assessment carries an assignee, and only a tracer run has a sample.
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_assignee_tracer_only"
  CHECK ("assigned_to" IS NULL OR "kind" = 'tracer');

-- The sample and how it was drawn are the audit record of a run: the elements a tracer
-- checks cannot be swapped afterwards for easier ones, and no element joins a sample once
-- the assessment is submitted.
CREATE FUNCTION tracer_sample_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% rows cannot change', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'assessment_element' AND EXISTS (
    SELECT 1 FROM assessment a WHERE a.id = NEW.assessment_id AND a.status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'assessment % is submitted and cannot change', NEW.assessment_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER assessment_element_frozen BEFORE INSERT OR UPDATE ON "assessment_element"
  FOR EACH ROW EXECUTE FUNCTION tracer_sample_frozen();
CREATE TRIGGER tracer_run_frozen BEFORE UPDATE ON "tracer_run"
  FOR EACH ROW EXECUTE FUNCTION tracer_sample_frozen();
