-- D135: the durable error log. One row per unexpected failure (and a few warnings), written by the app and read only by the developer.
--
-- The table is not append-only by trigger: the owner prunes old rows (npm run db:prune-errors). What keeps the app from reading or changing
-- it is its role, which may only INSERT (D136, src/server/db-roles/app-role.ts). user_id has no foreign key on purpose: an error row must be
-- writable even when the user row is the problem, and it must not block deleting a user.
CREATE TABLE "error_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "digest" TEXT,
    "request_id" TEXT,
    "route" TEXT NOT NULL,
    "method" TEXT,
    "status" INTEGER,
    "error_name" TEXT NOT NULL,
    "error_code" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "user_id" UUID,
    "role" TEXT,
    "deployment" TEXT,
    "environment" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "suppressed_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "error_events_ref_key" ON "error_events"("ref");
CREATE INDEX "error_events_occurred_at_idx" ON "error_events"("occurred_at" DESC);
CREATE INDEX "error_events_digest_idx" ON "error_events"("digest");
CREATE INDEX "error_events_request_id_idx" ON "error_events"("request_id");
CREATE INDEX "error_events_fingerprint_occurred_at_idx" ON "error_events"("fingerprint", "occurred_at");

-- The backstops: even a bug cannot store an unknown level or source, a text over the limits, or a negative count.
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_level_known" CHECK ("level" IN ('WARN', 'ERROR'));
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_source_known" CHECK ("source" IN ('ROUTE', 'PAGE', 'ACTION', 'MIDDLEWARE', 'PROVIDER', 'JOB', 'AUDIT', 'TEST'));
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_message_length" CHECK (length("message") <= 500);
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_stack_length" CHECK ("stack" IS NULL OR length("stack") <= 4000);
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_suppressed_count_not_negative" CHECK ("suppressed_count" >= 0);
