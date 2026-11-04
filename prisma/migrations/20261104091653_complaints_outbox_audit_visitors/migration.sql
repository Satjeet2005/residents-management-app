-- CreateEnum
CREATE TYPE "complaint_urgency" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "complaint_status" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "close_kind" AS ENUM ('CONFIRMED', 'AUTO_CLOSED', 'DUTY_MANAGER');

-- CreateEnum
CREATE TYPE "complaint_event_type" AS ENUM ('CREATED', 'CLASSIFIED', 'ASSIGNED', 'STATUS_CHANGED', 'COMMENT', 'REOPENED', 'CATEGORY_CORRECTED', 'DUPLICATE_LINKED', 'ESCALATED', 'AFFECTED_TOO', 'CLOSED');

-- CreateEnum
CREATE TYPE "classification_source" AS ENUM ('RULE', 'LLM', 'FALLBACK', 'MANUAL');

-- CreateEnum
CREATE TYPE "outbox_job_type" AS ENUM ('CLASSIFY_COMPLAINT', 'SEND_NOTIFICATION', 'ESCALATE_PAYMENT', 'AUTO_CLOSE_COMPLAINT', 'ACCRUE_DAILY');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "visitor_status" AS ENUM ('EXPECTED', 'ARRIVED', 'DEPARTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "complaint_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_assignee_id" UUID,

    CONSTRAINT "complaint_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flat_id" UUID NOT NULL,
    "raised_by_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT,
    "category_id" UUID,
    "urgency" "complaint_urgency" NOT NULL DEFAULT 'NORMAL',
    "safety_flag" BOOLEAN NOT NULL DEFAULT false,
    "status" "complaint_status" NOT NULL DEFAULT 'NEW',
    "assignee_id" UUID,
    "response_due_at" TIMESTAMPTZ(6),
    "first_response_at" TIMESTAMPTZ(6),
    "pending_confirmation_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "close_kind" "close_kind",
    "rating" INTEGER,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complaint_id" UUID NOT NULL,
    "event_type" "complaint_event_type" NOT NULL,
    "actor_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complaint_id" UUID NOT NULL,
    "source" "classification_source" NOT NULL,
    "category_id" UUID,
    "urgency" "complaint_urgency" NOT NULL,
    "confidence" DECIMAL(4,3),
    "latency_ms" INTEGER,
    "output_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "primary_id" UUID NOT NULL,
    "duplicate_id" UUID NOT NULL,
    "similarity" DECIMAL(4,3),
    "linked_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_affected" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complaint_id" UUID NOT NULL,
    "flat_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_affected_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_type" "outbox_job_type" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_after" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "body" JSONB NOT NULL DEFAULT '{}',
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_passes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flat_id" UUID NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "expected_at" TIMESTAMPTZ(6) NOT NULL,
    "purpose" TEXT,
    "status" "visitor_status" NOT NULL DEFAULT 'EXPECTED',

    CONSTRAINT "visitor_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "complaint_categories_code_key" ON "complaint_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_links_duplicate_id_key" ON "complaint_links"("duplicate_id");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_affected_complaint_id_flat_id_key" ON "complaint_affected"("complaint_id", "flat_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_jobs_idempotency_key_key" ON "outbox_jobs"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "notifications"("idempotency_key");

-- AddForeignKey
ALTER TABLE "complaint_categories" ADD CONSTRAINT "complaint_categories_default_assignee_id_fkey" FOREIGN KEY ("default_assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "complaint_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "complaint_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_links" ADD CONSTRAINT "complaint_links_primary_id_fkey" FOREIGN KEY ("primary_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_links" ADD CONSTRAINT "complaint_links_duplicate_id_fkey" FOREIGN KEY ("duplicate_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_links" ADD CONSTRAINT "complaint_links_linked_by_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_affected" ADD CONSTRAINT "complaint_affected_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_affected" ADD CONSTRAINT "complaint_affected_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Prisma cannot express these). Invariants K1-K9.
--
-- A CHECK passes when it evaluates to NULL, so every CHECK below is written so
-- a NULL in a nullable column makes it FALSE (or the column is NOT NULL):
-- nullable columns are always tested with IS [NOT] NULL, never compared bare.
-- ---------------------------------------------------------------------------

-- K9: complaint body is not blank (body is NOT NULL).
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_body_not_blank" CHECK (btrim("body") <> '');

-- K1: a safety complaint is CRITICAL (safety_flag and urgency are NOT NULL).
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_safety_requires_critical" CHECK (
  NOT "safety_flag" OR "urgency" = 'CRITICAL'
);

-- K2: a safety complaint never closes by itself: close_kind is NULL or
-- DUTY_MANAGER. close_kind is nullable, so the NULL case is explicit.
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_safety_never_auto_closes" CHECK (
  NOT "safety_flag" OR "close_kind" IS NULL OR "close_kind" = 'DUTY_MANAGER'
);

-- K3: status and closure agree. CLOSED has closed_at and close_kind; every
-- other status has neither. PENDING_CONFIRMATION has pending_confirmation_at.
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_closure_matches_status" CHECK (
  ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "close_kind" IS NOT NULL)
  OR ("status" <> 'CLOSED' AND "closed_at" IS NULL AND "close_kind" IS NULL)
);
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_pending_has_timestamp" CHECK (
  "status" <> 'PENDING_CONFIRMATION' OR "pending_confirmation_at" IS NOT NULL
);

-- K4: rating is 1..5 and only on a CLOSED / CONFIRMED complaint. The second
-- CHECK uses IS NOT NULL before the comparison: "close_kind = 'CONFIRMED'"
-- alone would be NULL (and so pass) when close_kind is NULL.
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_rating_in_range" CHECK (
  "rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5)
);
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_rating_only_when_confirmed_close" CHECK (
  "rating" IS NULL
  OR ("status" = 'CLOSED' AND "close_kind" IS NOT NULL AND "close_kind" = 'CONFIRMED')
);
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reopen_count_non_negative" CHECK ("reopen_count" >= 0);
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reopened_has_reopen_count" CHECK (
  "status" <> 'REOPENED' OR "reopen_count" >= 1
);

-- K5: complaint_events, classifications and audit_log are append-only,
-- reusing append_only_reject_change() from the payment_matches migration.
CREATE TRIGGER "complaint_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "complaint_events"
  FOR EACH ROW EXECUTE FUNCTION "append_only_reject_change"();
CREATE TRIGGER "complaint_events_no_truncate"
  BEFORE TRUNCATE ON "complaint_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_reject_change"();

CREATE TRIGGER "classifications_no_update_delete"
  BEFORE UPDATE OR DELETE ON "classifications"
  FOR EACH ROW EXECUTE FUNCTION "append_only_reject_change"();
CREATE TRIGGER "classifications_no_truncate"
  BEFORE TRUNCATE ON "classifications"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_reject_change"();

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "append_only_reject_change"();
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_reject_change"();

-- K6: a complaint is the duplicate of at most one primary (unique index on
-- duplicate_id above), never of itself, and never both a primary and a
-- duplicate. The last rule needs a trigger. An advisory lock serialises
-- concurrent link inserts, so two transactions cannot each pass the check
-- and together build a chain (A->B and B->C).
ALTER TABLE "complaint_links" ADD CONSTRAINT "complaint_links_primary_differs_from_duplicate" CHECK (
  "primary_id" <> "duplicate_id"
);

CREATE FUNCTION "complaint_links_reject_chain"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('complaint_links_chain'));
  IF EXISTS (
    SELECT 1 FROM "complaint_links"
    WHERE "primary_id" = NEW."duplicate_id" AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'complaint % is already a primary and cannot be a duplicate', NEW."duplicate_id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "complaint_links"
    WHERE "duplicate_id" = NEW."primary_id" AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'complaint % is already a duplicate and cannot be a primary', NEW."primary_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "complaint_links_no_chains"
  BEFORE INSERT OR UPDATE OF "primary_id", "duplicate_id" ON "complaint_links"
  FOR EACH ROW EXECUTE FUNCTION "complaint_links_reject_chain"();

-- K7: idempotency keys are unique (Prisma unique indexes above). A finished
-- job and a sent notification carry their timestamp.
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_finished_has_timestamp" CHECK (
  "status" NOT IN ('DONE', 'FAILED') OR "finished_at" IS NOT NULL
);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sent_has_timestamp" CHECK (
  "status" <> 'SENT' OR "sent_at" IS NOT NULL
);

-- K8: confidence is within [0, 1] when present.
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_confidence_in_range" CHECK (
  "confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)
);

-- K9: visitor name is not blank (visitor_name is NOT NULL); complaint_affected
-- uniqueness is the Prisma unique index on (complaint_id, flat_id) above.
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_name_not_blank" CHECK (btrim("visitor_name") <> '');
