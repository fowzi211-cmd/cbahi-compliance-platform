-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('self', 'tracer', 'mock_survey');

-- CreateEnum
CREATE TYPE "ScoreSource" AS ENUM ('internal', 'consultant');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('in_progress', 'submitted');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('document', 'observation', 'interview', 'record_review', 'kpi');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('esr', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'in_progress', 'closed', 'verified');

-- CreateTable
CREATE TABLE "assessment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "department_id" UUID,
    "kind" "AssessmentKind" NOT NULL DEFAULT 'self',
    "source" "ScoreSource" NOT NULL DEFAULT 'internal',
    "status" "AssessmentStatus" NOT NULL DEFAULT 'in_progress',
    "started_by" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),

    CONSTRAINT "assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element_score" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "score_level_id" UUID NOT NULL,
    "comment" TEXT,
    "scored_by" UUID,
    "scored_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "element_score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_evidence" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "element_score_id" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "note" TEXT,
    "url" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element_status" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "source" "ScoreSource" NOT NULL,
    "element_score_id" UUID NOT NULL,
    "level_code" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "element_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "element_score_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "department_id" UUID,
    "level_code" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'open',
    "statement" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessment_tenant_id_facility_id_started_at_idx" ON "assessment"("tenant_id", "facility_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_tenant_id_id_key" ON "assessment"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "element_score_tenant_id_assessment_id_idx" ON "element_score"("tenant_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "element_score_assessment_id_element_id_key" ON "element_score"("assessment_id", "element_id");

-- CreateIndex
CREATE UNIQUE INDEX "element_score_tenant_id_id_key" ON "element_score"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "score_evidence_tenant_id_element_score_id_idx" ON "score_evidence"("tenant_id", "element_score_id");

-- CreateIndex
CREATE INDEX "element_status_tenant_id_facility_id_idx" ON "element_status"("tenant_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "element_status_facility_id_element_id_source_key" ON "element_status"("facility_id", "element_id", "source");

-- CreateIndex
CREATE INDEX "finding_tenant_id_facility_id_status_idx" ON "finding"("tenant_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "finding_tenant_id_element_score_id_key" ON "finding"("tenant_id", "element_score_id");

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_score" ADD CONSTRAINT "element_score_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_score" ADD CONSTRAINT "element_score_tenant_id_assessment_id_fkey" FOREIGN KEY ("tenant_id", "assessment_id") REFERENCES "assessment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_score" ADD CONSTRAINT "element_score_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_score" ADD CONSTRAINT "element_score_score_level_id_fkey" FOREIGN KEY ("score_level_id") REFERENCES "score_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_tenant_id_element_score_id_fkey" FOREIGN KEY ("tenant_id", "element_score_id") REFERENCES "element_score"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_status" ADD CONSTRAINT "element_status_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_status" ADD CONSTRAINT "element_status_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_status" ADD CONSTRAINT "element_status_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_status" ADD CONSTRAINT "element_status_tenant_id_element_score_id_fkey" FOREIGN KEY ("tenant_id", "element_score_id") REFERENCES "element_score"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_tenant_id_assessment_id_fkey" FOREIGN KEY ("tenant_id", "assessment_id") REFERENCES "assessment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_tenant_id_element_score_id_fkey" FOREIGN KEY ("tenant_id", "element_score_id") REFERENCES "element_score"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for the assessment tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessment', 'element_score', 'score_evidence', 'element_status', 'finding'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

ALTER TABLE "assessment" ADD CONSTRAINT "assessment_submitted_consistent"
  CHECK (("status" = 'submitted') = ("submitted_at" IS NOT NULL));

-- Evidence must carry something a surveyor can look at: a link for a document, a note for
-- everything else.
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_has_content"
  CHECK (
    CASE WHEN "kind" = 'document' THEN "url" IS NOT NULL
         ELSE length(btrim(coalesce("note", ''))) > 0 END
  );

-- A submitted assessment is a record: nothing about it, its scores or its evidence may change
-- afterwards, whatever the application does. Corrections are a new assessment.
CREATE FUNCTION assessment_reject_if_submitted() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  locked boolean;
BEGIN
  IF TG_TABLE_NAME = 'assessment' THEN
    IF OLD.status = 'submitted' THEN
      RAISE EXCEPTION 'assessment % is submitted and cannot change', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_TABLE_NAME = 'element_score' THEN
    target := CASE WHEN TG_OP = 'DELETE' THEN OLD.assessment_id ELSE NEW.assessment_id END;
  ELSE
    SELECT s.assessment_id INTO target FROM element_score s
      WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.element_score_id ELSE NEW.element_score_id END;
  END IF;
  SELECT a.status = 'submitted' INTO locked FROM assessment a WHERE a.id = target;
  IF locked THEN
    RAISE EXCEPTION 'assessment % is submitted and cannot change', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER assessment_locked BEFORE UPDATE OR DELETE ON "assessment"
  FOR EACH ROW EXECUTE FUNCTION assessment_reject_if_submitted();
CREATE TRIGGER element_score_locked BEFORE INSERT OR UPDATE OR DELETE ON "element_score"
  FOR EACH ROW EXECUTE FUNCTION assessment_reject_if_submitted();
CREATE TRIGGER score_evidence_locked BEFORE INSERT OR UPDATE OR DELETE ON "score_evidence"
  FOR EACH ROW EXECUTE FUNCTION assessment_reject_if_submitted();
