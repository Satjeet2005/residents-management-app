-- L1: related rows must belong to the same flat.
--
-- Each composite foreign key pairs a reference with the row's own flat_id, so
-- a payment attempt, ledger entry or matched bank row cannot point at a bill,
-- attempt or entry of a different flat. The single-column foreign keys stay.
--
-- Composite foreign keys use MATCH SIMPLE: a NULL in any column skips the
-- check. That is the intended behaviour for the nullable references
-- (ledger_entries.bill_id, ledger_entries.payment_attempt_id,
-- bank_rows.ledger_entry_id, bank_rows.flat_id). For matched bank rows the
-- bank_rows_state_matches_links CHECK (J3) already requires both flat_id and
-- ledger_entry_id to be non-NULL, so a matched row cannot dodge this check.

-- CreateIndex: the targets of the composite foreign keys.
CREATE UNIQUE INDEX "bills_id_flat_id_key" ON "bills"("id", "flat_id");

CREATE UNIQUE INDEX "ledger_entries_id_flat_id_key" ON "ledger_entries"("id", "flat_id");

CREATE UNIQUE INDEX "payment_attempts_id_flat_id_key" ON "payment_attempts"("id", "flat_id");

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_bill_id_flat_id_fkey" FOREIGN KEY ("bill_id", "flat_id") REFERENCES "bills"("id", "flat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bill_id_flat_id_fkey" FOREIGN KEY ("bill_id", "flat_id") REFERENCES "bills"("id", "flat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_attempt_id_flat_id_fkey" FOREIGN KEY ("payment_attempt_id", "flat_id") REFERENCES "payment_attempts"("id", "flat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_rows" ADD CONSTRAINT "bank_rows_ledger_entry_id_flat_id_fkey" FOREIGN KEY ("ledger_entry_id", "flat_id") REFERENCES "ledger_entries"("id", "flat_id") ON DELETE RESTRICT ON UPDATE CASCADE;
