-- CreateEnum
CREATE TYPE "FrameworkStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "FrameworkImportStatus" AS ENUM ('validated', 'committed', 'discarded');

-- CreateTable
CREATE TABLE "framework" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "name_ar" TEXT,
    "name_en" TEXT,
    "program" TEXT NOT NULL,
    "status" "FrameworkStatus" NOT NULL DEFAULT 'draft',
    "rollup_config" JSONB NOT NULL,
    "license_note" TEXT,
    "activated_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "framework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_level" (
    "id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_ar" TEXT,
    "label_en" TEXT,
    "value" DECIMAL(4,3) NOT NULL,
    "counts_in_denominator" BOOLEAN NOT NULL,
    "requires_evidence" BOOLEAN NOT NULL,
    "generates_finding" BOOLEAN NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "score_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter" (
    "id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title_ar" TEXT,
    "title_en" TEXT,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard" (
    "id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title_ar" TEXT,
    "title_en" TEXT,
    "weight" DECIMAL(8,3) NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element" (
    "id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "standard_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title_ar" TEXT,
    "title_en" TEXT,
    "description_ar" TEXT,
    "description_en" TEXT,
    "is_esr" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(8,3) NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL,
    "evidence_types" TEXT[],
    "facility_types" TEXT[],
    "department_types" TEXT[],

    CONSTRAINT "element_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_type" (
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "facility_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "department_type" (
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "department_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "framework_import" (
    "id" UUID NOT NULL,
    "status" "FrameworkImportStatus" NOT NULL DEFAULT 'validated',
    "file_name" TEXT NOT NULL,
    "file_sha256" BYTEA NOT NULL,
    "format" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "framework_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ(6),

    CONSTRAINT "framework_import_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "framework_code_edition_key" ON "framework"("code", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "score_level_framework_id_code_key" ON "score_level"("framework_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_framework_id_code_key" ON "chapter"("framework_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_framework_id_id_key" ON "chapter"("framework_id", "id");

-- CreateIndex
CREATE INDEX "standard_chapter_id_idx" ON "standard"("chapter_id");

-- CreateIndex
CREATE UNIQUE INDEX "standard_framework_id_code_key" ON "standard"("framework_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "standard_framework_id_id_key" ON "standard"("framework_id", "id");

-- CreateIndex
CREATE INDEX "element_standard_id_idx" ON "element"("standard_id");

-- CreateIndex
CREATE UNIQUE INDEX "element_framework_id_code_key" ON "element"("framework_id", "code");

-- CreateIndex
CREATE INDEX "framework_import_status_created_at_idx" ON "framework_import"("status", "created_at");

-- AddForeignKey
ALTER TABLE "score_level" ADD CONSTRAINT "score_level_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter" ADD CONSTRAINT "chapter_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard" ADD CONSTRAINT "standard_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard" ADD CONSTRAINT "standard_framework_id_chapter_id_fkey" FOREIGN KEY ("framework_id", "chapter_id") REFERENCES "chapter"("framework_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element" ADD CONSTRAINT "element_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element" ADD CONSTRAINT "element_framework_id_standard_id_fkey" FOREIGN KEY ("framework_id", "standard_id") REFERENCES "standard"("framework_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framework_import" ADD CONSTRAINT "framework_import_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "framework"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: integrity rules, catalogues, grants and Row-Level Security for the
-- standards library (docs/ARCHITECTURE.md §3.1 and §9).
-- ---------------------------------------------------------------------------

-- Only one live edition per framework code: tenants must never see two versions of the
-- same requirement at once.
CREATE UNIQUE INDEX "framework_one_active_per_code" ON "framework" ("code") WHERE "status" = 'active';

-- An edition cannot go live without a recorded licence (CBAHI and others own their text).
ALTER TABLE "framework" ADD CONSTRAINT "framework_active_needs_license"
  CHECK ("status" = 'draft' OR length(btrim(coalesce("license_note", ''))) > 0);
ALTER TABLE "framework" ADD CONSTRAINT "framework_has_name"
  CHECK ("name_ar" IS NOT NULL OR "name_en" IS NOT NULL);
ALTER TABLE "chapter" ADD CONSTRAINT "chapter_has_title"
  CHECK ("title_ar" IS NOT NULL OR "title_en" IS NOT NULL);
ALTER TABLE "standard" ADD CONSTRAINT "standard_has_title"
  CHECK ("title_ar" IS NOT NULL OR "title_en" IS NOT NULL);
ALTER TABLE "element" ADD CONSTRAINT "element_has_title"
  CHECK ("title_ar" IS NOT NULL OR "title_en" IS NOT NULL);
ALTER TABLE "standard" ADD CONSTRAINT "standard_weight_positive" CHECK ("weight" > 0);
ALTER TABLE "element" ADD CONSTRAINT "element_weight_positive" CHECK ("weight" > 0);
ALTER TABLE "score_level" ADD CONSTRAINT "score_level_value_range" CHECK ("value" BETWEEN 0 AND 1);

-- Browsing by department filters on this array.
CREATE INDEX "element_department_types_idx" ON "element" USING GIN ("department_types");

-- Generic catalogues. Labels are ours, not taken from any accreditation manual.
INSERT INTO "facility_type" ("code", "name_ar", "name_en", "sort") VALUES
  ('hospital', 'مستشفى', 'Hospital', 1),
  ('polyclinic', 'مجمع عيادات', 'Polyclinic', 2),
  ('primary_care', 'رعاية صحية أولية', 'Primary care', 3),
  ('dental', 'طب الأسنان', 'Dental', 4),
  ('laboratory', 'مختبر', 'Laboratory', 5),
  ('home_care', 'رعاية منزلية', 'Home care', 6),
  ('other', 'أخرى', 'Other', 7);

INSERT INTO "department_type" ("code", "name_ar", "name_en", "sort") VALUES
  ('administration', 'الإدارة', 'Administration', 1),
  ('quality', 'الجودة وسلامة المرضى', 'Quality and patient safety', 2),
  ('reception', 'الاستقبال والتسجيل', 'Reception and registration', 3),
  ('outpatient', 'العيادات الخارجية', 'Outpatient clinics', 4),
  ('emergency', 'الطوارئ', 'Emergency', 5),
  ('nursing', 'التمريض', 'Nursing', 6),
  ('pharmacy', 'الصيدلية', 'Pharmacy', 7),
  ('laboratory', 'المختبر', 'Laboratory', 8),
  ('radiology', 'الأشعة', 'Radiology', 9),
  ('dental', 'الأسنان', 'Dental', 10),
  ('infection_control', 'مكافحة العدوى', 'Infection control', 11),
  ('sterilization', 'التعقيم', 'Sterilization', 12),
  ('facility_management', 'إدارة المرافق والسلامة', 'Facility management and safety', 13),
  ('human_resources', 'الموارد البشرية', 'Human resources', 14),
  ('health_information', 'المعلومات الصحية', 'Health information', 15);

-- The app reads the library but never writes it; the platform admin writes through the
-- system role. Import staging is platform-only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  "framework", "score_level", "chapter", "standard", "element", "facility_type", "department_type"
  FROM mustamir_app;
REVOKE ALL ON "framework_import" FROM mustamir_app;

-- Drafts are invisible to the app role. Child rows follow their edition: the subquery on
-- "framework" is itself filtered by the policy above.
ALTER TABLE "framework" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "framework" FORCE ROW LEVEL SECURITY;
CREATE POLICY "published_editions" ON "framework" FOR SELECT TO mustamir_app
  USING ("status" <> 'draft');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['score_level', 'chapter', 'standard', 'element'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY published_editions ON %I FOR SELECT TO mustamir_app '
      'USING (framework_id IN (SELECT id FROM framework))', t);
  END LOOP;
END
$$;
