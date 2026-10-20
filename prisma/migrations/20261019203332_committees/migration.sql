-- CreateEnum
CREATE TYPE "CommitteeFrequency" AS ENUM ('monthly', 'quarterly', 'semiannual', 'annual');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'minutes';

-- CreateTable
CREATE TABLE "committee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name_ar" TEXT,
    "name_en" TEXT,
    "frequency" "CommitteeFrequency" NOT NULL,
    "chair_user_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "committee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_element" (
    "tenant_id" UUID NOT NULL,
    "committee_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_element_pkey" PRIMARY KEY ("committee_id","element_id")
);

-- CreateTable
CREATE TABLE "meeting" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "committee_id" UUID NOT NULL,
    "held_on" DATE NOT NULL,
    "minutes_document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "committee_tenant_id_facility_id_idx" ON "committee"("tenant_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_tenant_id_id_key" ON "committee"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "committee_element_tenant_id_committee_id_idx" ON "committee_element"("tenant_id", "committee_id");

-- CreateIndex
CREATE INDEX "meeting_tenant_id_committee_id_idx" ON "meeting"("tenant_id", "committee_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_committee_id_held_on_key" ON "meeting"("committee_id", "held_on");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_tenant_id_minutes_document_id_key" ON "meeting"("tenant_id", "minutes_document_id");

-- AddForeignKey
ALTER TABLE "committee" ADD CONSTRAINT "committee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee" ADD CONSTRAINT "committee_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_element" ADD CONSTRAINT "committee_element_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_element" ADD CONSTRAINT "committee_element_tenant_id_committee_id_fkey" FOREIGN KEY ("tenant_id", "committee_id") REFERENCES "committee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_element" ADD CONSTRAINT "committee_element_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_tenant_id_committee_id_fkey" FOREIGN KEY ("tenant_id", "committee_id") REFERENCES "committee"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_tenant_id_minutes_document_id_fkey" FOREIGN KEY ("tenant_id", "minutes_document_id") REFERENCES "document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation and integrity rules for committees.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['committee', 'committee_element', 'meeting'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

ALTER TABLE "committee" ADD CONSTRAINT "committee_named" CHECK (
  length(btrim(coalesce("name_ar", ''))) > 0 OR length(btrim(coalesce("name_en", ''))) > 0);

-- Minutes are the record that a meeting took place and what it decided. Once filed they
-- belong to the meeting for good: a correction is a new version of the same document, the
-- meeting cannot move to another day, and it cannot be deleted. The document must be
-- minutes of the committee's own facility.
CREATE FUNCTION meeting_minutes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.minutes_document_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'a meeting with minutes cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.minutes_document_id IS DISTINCT FROM OLD.minutes_document_id
       OR NEW.held_on <> OLD.held_on OR NEW.committee_id <> OLD.committee_id THEN
      RAISE EXCEPTION 'meeting % has minutes and cannot change', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.minutes_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document d JOIN committee c ON c.id = NEW.committee_id
    WHERE d.id = NEW.minutes_document_id AND d.type = 'minutes' AND d.facility_id = c.facility_id
  ) THEN
    RAISE EXCEPTION 'minutes of meeting % must be a minutes document of its facility', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER meeting_minutes_guard BEFORE INSERT OR UPDATE OR DELETE ON "meeting"
  FOR EACH ROW EXECUTE FUNCTION meeting_minutes_guard();
