-- CreateEnum
CREATE TYPE "bank_row_state" AS ENUM ('QUEUED', 'AUTO_MATCHED', 'AWAITING_APPROVAL', 'MANUALLY_MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "match_decision" AS ENUM ('AUTO', 'MANUAL', 'REQUEST_APPROVAL', 'APPROVED', 'REJECTED', 'IGNORE', 'UNDO');

-- CreateEnum
CREATE TYPE "identifier_type" AS ENUM ('UPI_ID', 'NAME');

-- CreateEnum
CREATE TYPE "payer_source" AS ENUM ('MANUAL', 'LEARNED');

-- CreateEnum
CREATE TYPE "queue_item_type" AS ENUM ('UNRESOLVED_PAYMENT', 'EXCEPTION', 'BANK_ROW');

-- CreateEnum
CREATE TYPE "queue_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "statement_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploaded_by_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rows_read" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "txn_date" DATE NOT NULL,
    "value_date" DATE,
    "narration_raw" TEXT NOT NULL,
    "credit_paise" BIGINT NOT NULL DEFAULT 0,
    "debit_paise" BIGINT NOT NULL DEFAULT 0,
    "balance_paise" BIGINT,
    "dedupe_key" TEXT NOT NULL,
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "state" "bank_row_state" NOT NULL DEFAULT 'QUEUED',
    "flat_id" UUID,
    "ledger_entry_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bank_row_id" UUID NOT NULL,
    "decision" "match_decision" NOT NULL,
    "flat_id" UUID,
    "score" INTEGER,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "decided_by_id" UUID,
    "approver_id" UUID,
    "reason" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "known_payers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flat_id" UUID NOT NULL,
    "identifier_type" "identifier_type" NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "source" "payer_source" NOT NULL,
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_queue_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_type" "queue_item_type" NOT NULL,
    "bank_row_id" UUID,
    "payment_attempt_id" UUID,
    "status" "queue_status" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "note" TEXT,

    CONSTRAINT "accounts_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_rows_dedupe_key_key" ON "bank_rows"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "bank_rows_import_id_row_number_key" ON "bank_rows"("import_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "known_payers_identifier_type_identifier_value_flat_id_key" ON "known_payers"("identifier_type", "identifier_value", "flat_id");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bank_row_id_fkey" FOREIGN KEY ("bank_row_id") REFERENCES "bank_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rows" ADD CONSTRAINT "bank_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rows" ADD CONSTRAINT "bank_rows_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rows" ADD CONSTRAINT "bank_rows_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_bank_row_id_fkey" FOREIGN KEY ("bank_row_id") REFERENCES "bank_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_payers" ADD CONSTRAINT "known_payers_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_payers" ADD CONSTRAINT "known_payers_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_queue_items" ADD CONSTRAINT "accounts_queue_items_bank_row_id_fkey" FOREIGN KEY ("bank_row_id") REFERENCES "bank_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_queue_items" ADD CONSTRAINT "accounts_queue_items_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_queue_items" ADD CONSTRAINT "accounts_queue_items_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Prisma cannot express these). Invariants J1-J8.
-- ---------------------------------------------------------------------------

-- J1: dedupe_key and (import_id, row_number) are unique (Prisma unique indexes above).

-- J2: exactly one of credit and debit is positive; neither is negative.
ALTER TABLE "bank_rows" ADD CONSTRAINT "bank_rows_exactly_one_side_positive" CHECK (
  "credit_paise" >= 0 AND "debit_paise" >= 0
  AND (("credit_paise" > 0) <> ("debit_paise" > 0))
);

-- J3: state and links agree. Matched rows carry flat and ledger entry;
-- QUEUED, AWAITING_APPROVAL and IGNORED rows have no ledger entry.
ALTER TABLE "bank_rows" ADD CONSTRAINT "bank_rows_state_matches_links" CHECK (
  ("state" IN ('AUTO_MATCHED', 'MANUALLY_MATCHED')
     AND "flat_id" IS NOT NULL AND "ledger_entry_id" IS NOT NULL)
  OR ("state" IN ('QUEUED', 'AWAITING_APPROVAL', 'IGNORED')
     AND "ledger_entry_id" IS NULL)
);

-- J4: payment_matches is an append-only decision log, like the ledger.
CREATE FUNCTION "append_only_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "payment_matches_no_update_delete"
  BEFORE UPDATE OR DELETE ON "payment_matches"
  FOR EACH ROW EXECUTE FUNCTION "append_only_reject_change"();

CREATE TRIGGER "payment_matches_no_truncate"
  BEFORE TRUNCATE ON "payment_matches"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_reject_change"();

-- J5: maker-checker and honesty. The approver differs from the decider
-- (IS DISTINCT FROM is NULL-safe); human decisions name an actor and give a
-- non-blank reason; AUTO decisions have no human actor.
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_approver_differs" CHECK (
  "approver_id" IS NULL OR "approver_id" IS DISTINCT FROM "decided_by_id"
);
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_human_decision_has_actor_and_reason" CHECK (
  "decision" NOT IN ('MANUAL', 'REQUEST_APPROVAL', 'APPROVED', 'REJECTED', 'IGNORE', 'UNDO')
  OR ("decided_by_id" IS NOT NULL AND "reason" IS NOT NULL AND btrim("reason") <> '')
);
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_auto_has_no_actor" CHECK (
  "decision" <> 'AUTO' OR "decided_by_id" IS NULL
);

-- J6: a bank row can fund at most one PAYMENT entry. A REVERSAL that
-- references the same bank row is not a PAYMENT and stays allowed.
CREATE UNIQUE INDEX "ledger_entries_one_payment_per_bank_row"
  ON "ledger_entries"("bank_row_id")
  WHERE "entry_type" = 'PAYMENT' AND "bank_row_id" IS NOT NULL;

-- J7: queue items point at the right thing, are open at most once per target,
-- and cannot be resolved without who, when and why. EXCEPTION items may
-- reference either target, so they have no reference rule.
ALTER TABLE "accounts_queue_items" ADD CONSTRAINT "accounts_queue_items_reference_matches_type" CHECK (
  ("item_type" = 'UNRESOLVED_PAYMENT' AND "payment_attempt_id" IS NOT NULL AND "bank_row_id" IS NULL)
  OR ("item_type" = 'BANK_ROW' AND "bank_row_id" IS NOT NULL AND "payment_attempt_id" IS NULL)
  OR "item_type" = 'EXCEPTION'
);
CREATE UNIQUE INDEX "accounts_queue_items_one_open_per_bank_row"
  ON "accounts_queue_items"("bank_row_id")
  WHERE "status" = 'OPEN' AND "bank_row_id" IS NOT NULL;
CREATE UNIQUE INDEX "accounts_queue_items_one_open_per_payment_attempt"
  ON "accounts_queue_items"("payment_attempt_id")
  WHERE "status" = 'OPEN' AND "payment_attempt_id" IS NOT NULL;
ALTER TABLE "accounts_queue_items" ADD CONSTRAINT "accounts_queue_items_resolved_has_who_when_why" CHECK (
  "status" <> 'RESOLVED'
  OR ("resolved_at" IS NOT NULL AND "resolved_by_id" IS NOT NULL
      AND "note" IS NOT NULL AND btrim("note") <> '')
);

-- J8: a known payer identifier is not blank; uniqueness is the Prisma unique
-- index on (identifier_type, identifier_value, flat_id) above.
ALTER TABLE "known_payers" ADD CONSTRAINT "known_payers_identifier_not_blank" CHECK (
  btrim("identifier_value") <> ''
);
