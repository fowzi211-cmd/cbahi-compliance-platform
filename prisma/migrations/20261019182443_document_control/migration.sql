-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('policy', 'procedure', 'form', 'plan', 'other');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('in_review', 'approved', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');

-- AlterTable
ALTER TABLE "score_evidence" ADD COLUMN     "document_version_id" UUID;

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "department_id" UUID,
    "type" "DocumentType" NOT NULL,
    "title_ar" TEXT,
    "title_en" TEXT,
    "owner_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'in_review',
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" BYTEA NOT NULL,
    "storage_key" TEXT NOT NULL,
    "effective_on" DATE,
    "review_on" DATE,
    "expires_on" DATE,
    "change_note" TEXT,
    "phi_attested" BOOLEAN NOT NULL,
    "phi_scan" JSONB NOT NULL,
    "phi_override" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "approver_user_id" UUID,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_element" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_element_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_tenant_id_facility_id_idx" ON "document"("tenant_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_tenant_id_id_key" ON "document"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "document_version_tenant_id_document_id_idx" ON "document_version"("tenant_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_document_id_version_key" ON "document_version"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_tenant_id_id_key" ON "document_version"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "document_approval_tenant_id_version_id_idx" ON "document_approval"("tenant_id", "version_id");

-- CreateIndex
CREATE INDEX "document_element_tenant_id_element_id_idx" ON "document_element"("tenant_id", "element_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_element_document_id_element_id_key" ON "document_element"("document_id", "element_id");

-- AddForeignKey
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_tenant_id_document_version_id_fkey" FOREIGN KEY ("tenant_id", "document_version_id") REFERENCES "document_version"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "document"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_approval" ADD CONSTRAINT "document_approval_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_approval" ADD CONSTRAINT "document_approval_tenant_id_version_id_fkey" FOREIGN KEY ("tenant_id", "version_id") REFERENCES "document_version"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_element" ADD CONSTRAINT "document_element_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_element" ADD CONSTRAINT "document_element_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "document"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_element" ADD CONSTRAINT "document_element_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for document control.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document', 'document_version', 'document_approval', 'document_element'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

ALTER TABLE "document" ADD CONSTRAINT "document_has_title"
  CHECK (length(btrim(coalesce("title_ar", ''))) > 0 OR length(btrim(coalesce("title_en", ''))) > 0);

-- Nothing is stored without the uploader's "no patient data" attestation.
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_phi_attested" CHECK ("phi_attested");
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_sha256_length" CHECK (length("sha256") = 32);
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_dates_in_order" CHECK (
  ("effective_on" IS NULL OR "review_on" IS NULL OR "review_on" > "effective_on") AND
  ("effective_on" IS NULL OR "expires_on" IS NULL OR "expires_on" > "effective_on") AND
  ("review_on" IS NULL OR "expires_on" IS NULL OR "expires_on" >= "review_on"));

-- A cited document is either a library version (from M8) or a link (cited before M8).
ALTER TABLE "score_evidence" DROP CONSTRAINT "score_evidence_has_content";
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_has_content"
  CHECK (
    CASE WHEN "kind" = 'document' THEN "url" IS NOT NULL OR "document_version_id" IS NOT NULL
         ELSE length(btrim(coalesce("note", ''))) > 0 END
  );

-- A version is a record of exactly what was approved: its file and its PHI checks never
-- change, and versions are never deleted. Only the status (and dates before approval) move.
CREATE FUNCTION document_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document versions cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.document_id, NEW.version, NEW.file_name, NEW.content_type, NEW.bytes, NEW.sha256,
      NEW.storage_key, NEW.phi_attested, NEW.phi_scan, NEW.phi_override, NEW.uploaded_by,
      NEW.uploaded_at)
     IS DISTINCT FROM
     (OLD.document_id, OLD.version, OLD.file_name, OLD.content_type, OLD.bytes, OLD.sha256,
      OLD.storage_key, OLD.phi_attested, OLD.phi_scan, OLD.phi_override, OLD.uploaded_by,
      OLD.uploaded_at) THEN
    RAISE EXCEPTION 'a document version''s file cannot change; upload a new version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'in_review' AND
     (NEW.effective_on, NEW.review_on, NEW.expires_on) IS DISTINCT FROM
     (OLD.effective_on, OLD.review_on, OLD.expires_on) THEN
    RAISE EXCEPTION 'the dates of a decided version cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER document_version_immutable BEFORE UPDATE OR DELETE ON "document_version"
  FOR EACH ROW EXECUTE FUNCTION document_version_immutable();

-- Approval decisions are part of the record: append only.
CREATE FUNCTION document_approval_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'approval decisions cannot be changed or deleted' USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER document_approval_append_only BEFORE UPDATE OR DELETE ON "document_approval"
  FOR EACH ROW EXECUTE FUNCTION document_approval_append_only();
