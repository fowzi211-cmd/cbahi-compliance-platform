-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('immediate', 'digest');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('pending', 'sent', 'skipped', 'failed');

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "priority" "NotificationPriority" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "email_status" "EmailStatus" NOT NULL DEFAULT 'pending',
    "emailed_at" TIMESTAMPTZ(6),
    "email_attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email_immediate" BOOLEAN NOT NULL DEFAULT true,
    "email_digest" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("tenant_id","user_id")
);

-- CreateIndex
CREATE INDEX "notification_tenant_id_user_id_created_at_idx" ON "notification"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_tenant_id_email_status_idx" ON "notification"("tenant_id", "email_status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_tenant_id_user_id_dedupe_key_key" ON "notification"("tenant_id", "user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facility"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: tenant isolation, integrity, and the job queue's schema.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification', 'notification_preference'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

ALTER TABLE "notification" ADD CONSTRAINT "notification_emailed_consistent"
  CHECK (("email_status" = 'sent') = ("emailed_at" IS NOT NULL));
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_locale"
  CHECK ("locale" IS NULL OR "locale" IN ('ar', 'en'));

-- pg-boss (the job queue) keeps its tables in their own schema, owned by the worker's role.
-- It never holds tenant data: jobs carry no payload beyond a tenant id and a date.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mustamir_system;
