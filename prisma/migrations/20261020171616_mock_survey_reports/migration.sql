-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'report';

-- CreateTable
CREATE TABLE "survey_report" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survey_report_tenant_id_assessment_id_idx" ON "survey_report"("tenant_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_report_assessment_id_locale_key" ON "survey_report"("assessment_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "survey_report_tenant_id_document_id_key" ON "survey_report"("tenant_id", "document_id");

-- AddForeignKey
ALTER TABLE "survey_report" ADD CONSTRAINT "survey_report_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_report" ADD CONSTRAINT "survey_report_tenant_id_assessment_id_fkey" FOREIGN KEY ("tenant_id", "assessment_id") REFERENCES "assessment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_report" ADD CONSTRAINT "survey_report_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "document"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for mock survey reports.
-- ---------------------------------------------------------------------------

ALTER TABLE "survey_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "survey_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "survey_report"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "survey_report" ADD CONSTRAINT "survey_report_locale" CHECK ("locale" IN ('ar', 'en'));

-- A report describes a locked mock survey and is filed as a `report` document of the same
-- facility. Anything else would let a report claim a survey it does not come from.
CREATE FUNCTION survey_report_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a record;
  d record;
BEGIN
  SELECT kind, status, facility_id INTO a FROM assessment
    WHERE tenant_id = NEW.tenant_id AND id = NEW.assessment_id;
  SELECT type, facility_id INTO d FROM document
    WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id;
  IF a.kind IS DISTINCT FROM 'mock_survey' OR a.status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'a report needs a submitted mock survey' USING ERRCODE = 'check_violation';
  END IF;
  IF d.type IS DISTINCT FROM 'report' OR d.facility_id IS DISTINCT FROM a.facility_id THEN
    RAISE EXCEPTION 'a report is a report document of the survey''s facility'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER survey_report_matches BEFORE INSERT ON "survey_report"
  FOR EACH ROW EXECUTE FUNCTION survey_report_matches();

-- The link between a survey and its printed report is part of the record: append only.
CREATE FUNCTION survey_report_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'survey reports cannot be changed or deleted' USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER survey_report_append_only BEFORE UPDATE OR DELETE ON "survey_report"
  FOR EACH ROW EXECUTE FUNCTION survey_report_append_only();
