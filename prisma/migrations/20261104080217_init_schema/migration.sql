-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('RESIDENT', 'STAFF');

-- CreateEnum
CREATE TYPE "flat_relation" AS ENUM ('OWNER', 'TENANT', 'FAMILY');

-- CreateEnum
CREATE TYPE "entry_type" AS ENUM ('BILL', 'LATE_FEE', 'PAYMENT', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "direction" AS ENUM ('CHARGE', 'PAYMENT');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RELEASED');

-- CreateEnum
CREATE TYPE "debit_status" AS ENUM ('CONFIRMED', 'NOT_DEBITED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "flats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "tower" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "area_sqft" INTEGER NOT NULL,

    CONSTRAINT "flats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flat_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flat_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "relation" "flat_relation" NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,

    CONSTRAINT "flat_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "society_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "society_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flat_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "area_sqft_snapshot" INTEGER NOT NULL,
    "rate_paise_per_sqft" INTEGER NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flat_id" UUID NOT NULL,
    "entry_type" "entry_type" NOT NULL,
    "direction" "direction" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "effective_date" DATE NOT NULL,
    "bill_id" UUID,
    "payment_attempt_id" UUID,
    "bank_row_id" UUID,
    "reverses_entry_id" UUID,
    "reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" UUID NOT NULL,
    "flat_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "status" "attempt_status" NOT NULL,
    "debit_status" "debit_status" NOT NULL DEFAULT 'UNKNOWN',
    "gateway_reference" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hold_started_at" TIMESTAMPTZ(6),
    "hold_ended_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "release_reason" TEXT,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flats_code_key" ON "flats"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "flat_members_flat_id_user_id_starts_on_key" ON "flat_members"("flat_id", "user_id", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_user_id_permission_key" ON "user_permissions"("user_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "bills_flat_id_period_key" ON "bills"("flat_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_entry_id_key" ON "ledger_entries"("reverses_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reference_key" ON "ledger_entries"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_gateway_reference_key" ON "payment_attempts"("gateway_reference");

-- AddForeignKey
ALTER TABLE "flat_members" ADD CONSTRAINT "flat_members_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flat_members" ADD CONSTRAINT "flat_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Prisma cannot express these). Invariants I1-I8.
-- ---------------------------------------------------------------------------

-- I8: value sanity on other tables.
ALTER TABLE "flats" ADD CONSTRAINT "flats_area_sqft_positive" CHECK ("area_sqft" > 0);
ALTER TABLE "bills" ADD CONSTRAINT "bills_amount_paise_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "bills" ADD CONSTRAINT "bills_due_on_not_before_issued_on" CHECK ("due_on" >= "issued_on");
ALTER TABLE "bills" ADD CONSTRAINT "bills_period_is_first_of_month" CHECK (EXTRACT(DAY FROM "period") = 1);

-- I1: ledger amounts are strictly positive; direction carries the sign.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_paise_positive" CHECK ("amount_paise" > 0);

-- I2: entry type fixes the direction (REVERSAL and ADJUSTMENT may be either).
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_type_direction" CHECK (
  ("entry_type" IN ('BILL', 'LATE_FEE') AND "direction" = 'CHARGE')
  OR ("entry_type" = 'PAYMENT' AND "direction" = 'PAYMENT')
  OR "entry_type" IN ('REVERSAL', 'ADJUSTMENT')
);

-- I5: a REVERSAL names the entry it reverses (the unique index on
-- reverses_entry_id, created above, lets an entry be reversed at most once);
-- an ADJUSTMENT must explain itself.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_has_target" CHECK (
  "entry_type" <> 'REVERSAL' OR "reverses_entry_id" IS NOT NULL
);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_adjustment_has_note" CHECK (
  "entry_type" <> 'ADJUSTMENT' OR ("note" IS NOT NULL AND btrim("note") <> '')
);

-- I3: the ledger is append-only. Reject UPDATE and DELETE per row, and TRUNCATE.
CREATE FUNCTION "ledger_entries_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ledger_entries_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_reject_change"();

CREATE TRIGGER "ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_entries_reject_change"();

-- Payment attempts. Amounts are positive.
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_paise_positive" CHECK ("amount_paise" > 0);

-- I6: at most ONE unresolved attempt per bill.
CREATE UNIQUE INDEX "payment_attempts_one_unresolved_per_bill"
  ON "payment_attempts"("bill_id")
  WHERE "status" IN ('INITIATED', 'PROCESSING');

-- I7: a RELEASED attempt carries a reason. (gateway_reference uniqueness is
-- the unique index created above; NULLs do not collide.)
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_released_has_reason" CHECK (
  "status" <> 'RELEASED' OR ("release_reason" IS NOT NULL AND btrim("release_reason") <> '')
);
