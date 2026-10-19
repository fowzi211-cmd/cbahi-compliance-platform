/*
  Warnings:

  - A unique constraint covering the columns `[tenant_id,id]` on the table `finding` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CapaStatus" AS ENUM ('open', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "CapaEvidenceKind" AS ENUM ('document', 'link');

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "finding" ADD COLUMN     "closed_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_score_id" UUID;

-- CreateTable
CREATE TABLE "capa_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "department_id" UUID,
    "action" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "due_on" DATE NOT NULL,
    "status" "CapaStatus" NOT NULL DEFAULT 'open',
    "closure_note" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "capa_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capa_evidence" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "capa_item_id" UUID NOT NULL,
    "kind" "CapaEvidenceKind" NOT NULL,
    "document_version_id" UUID,
    "url" TEXT,
    "description" TEXT,
    "added_by" UUID,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capa_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capa_item_tenant_id_finding_id_idx" ON "capa_item"("tenant_id", "finding_id");

-- CreateIndex
CREATE INDEX "capa_item_tenant_id_facility_id_status_due_on_idx" ON "capa_item"("tenant_id", "facility_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "capa_item_tenant_id_owner_user_id_idx" ON "capa_item"("tenant_id", "owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "capa_item_tenant_id_id_key" ON "capa_item"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "capa_evidence_tenant_id_capa_item_id_idx" ON "capa_evidence"("tenant_id", "capa_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "finding_tenant_id_id_key" ON "finding"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_tenant_id_verified_score_id_fkey" FOREIGN KEY ("tenant_id", "verified_score_id") REFERENCES "element_score"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa_item" ADD CONSTRAINT "capa_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa_item" ADD CONSTRAINT "capa_item_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa_item" ADD CONSTRAINT "capa_item_tenant_id_finding_id_fkey" FOREIGN KEY ("tenant_id", "finding_id") REFERENCES "finding"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa_evidence" ADD CONSTRAINT "capa_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa_evidence" ADD CONSTRAINT "capa_evidence_tenant_id_capa_item_id_fkey" FOREIGN KEY ("tenant_id", "capa_item_id") REFERENCES "capa_item"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa_evidence" ADD CONSTRAINT "capa_evidence_tenant_id_document_version_id_fkey" FOREIGN KEY ("tenant_id", "document_version_id") REFERENCES "document_version"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for findings and CAPA.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['capa_item', 'capa_evidence'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

-- A closed finding records when it closed; a verified one names the score that proved it.
ALTER TABLE "finding" ADD CONSTRAINT "finding_closure_consistent" CHECK (
  ("status" IN ('closed', 'verified')) = ("closed_at" IS NOT NULL) AND
  ("status" = 'verified') = ("verified_at" IS NOT NULL AND "verified_score_id" IS NOT NULL));

ALTER TABLE "capa_item" ADD CONSTRAINT "capa_item_has_action"
  CHECK (length(btrim("action")) > 0);

-- Done means closed, with a note saying what was done (rule 7).
ALTER TABLE "capa_item" ADD CONSTRAINT "capa_item_done_consistent" CHECK (
  ("status" = 'done') = ("closed_at" IS NOT NULL) AND
  ("status" <> 'done' OR length(btrim(coalesce("closure_note", ''))) > 0));

ALTER TABLE "capa_evidence" ADD CONSTRAINT "capa_evidence_has_content" CHECK (
  CASE WHEN "kind" = 'document' THEN "document_version_id" IS NOT NULL
       ELSE "url" IS NOT NULL END);

-- Anti-decoration (rule 7): an action cannot be marked done without closure evidence.
CREATE FUNCTION capa_item_done_needs_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status <> 'done') AND NOT EXISTS (
    SELECT 1 FROM capa_evidence e WHERE e.tenant_id = NEW.tenant_id AND e.capa_item_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a CAPA item needs closure evidence before it is done'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER capa_item_done_needs_evidence BEFORE INSERT OR UPDATE ON "capa_item"
  FOR EACH ROW EXECUTE FUNCTION capa_item_done_needs_evidence();

-- The evidence of a closed (or cancelled) action is part of the record: it changes only
-- after the action is reopened. A cascade from deleting the item itself is allowed.
CREATE FUNCTION capa_evidence_frozen_when_closed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.capa_item_id ELSE NEW.capa_item_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM capa_item i WHERE i.id = item_id AND i.status IN ('done', 'cancelled')) THEN
    RAISE EXCEPTION 'evidence of a closed CAPA item cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER capa_evidence_frozen_when_closed BEFORE INSERT OR UPDATE OR DELETE ON "capa_evidence"
  FOR EACH ROW EXECUTE FUNCTION capa_evidence_frozen_when_closed();
