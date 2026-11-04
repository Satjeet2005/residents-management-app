-- "Not blank" checks used btrim(x) <> '', which trims only spaces, so a value
-- of tabs or newlines (for example E'\t\n') counted as non-blank. Replace each
-- with a regex that requires a non-whitespace character: x ~ '\S'.
-- \S treats space, tab, newline, carriage return, vertical tab and form feed
-- as whitespace. Each nullable column keeps its explicit IS NOT NULL guard so
-- a NULL makes the CHECK false rather than letting it pass.

ALTER TABLE "ledger_entries"
  DROP CONSTRAINT "ledger_entries_adjustment_has_note",
  ADD CONSTRAINT "ledger_entries_adjustment_has_note" CHECK (
    "entry_type" <> 'ADJUSTMENT' OR ("note" IS NOT NULL AND "note" ~ '\S')
  );

ALTER TABLE "payment_attempts"
  DROP CONSTRAINT "payment_attempts_released_has_reason",
  ADD CONSTRAINT "payment_attempts_released_has_reason" CHECK (
    "status" <> 'RELEASED' OR ("release_reason" IS NOT NULL AND "release_reason" ~ '\S')
  );

ALTER TABLE "payment_matches"
  DROP CONSTRAINT "payment_matches_human_decision_has_actor_and_reason",
  ADD CONSTRAINT "payment_matches_human_decision_has_actor_and_reason" CHECK (
    "decision" NOT IN ('MANUAL', 'REQUEST_APPROVAL', 'APPROVED', 'REJECTED', 'IGNORE', 'UNDO')
    OR ("decided_by_id" IS NOT NULL AND "reason" IS NOT NULL AND "reason" ~ '\S')
  );

ALTER TABLE "accounts_queue_items"
  DROP CONSTRAINT "accounts_queue_items_resolved_has_who_when_why",
  ADD CONSTRAINT "accounts_queue_items_resolved_has_who_when_why" CHECK (
    "status" <> 'RESOLVED'
    OR ("resolved_at" IS NOT NULL AND "resolved_by_id" IS NOT NULL
        AND "note" IS NOT NULL AND "note" ~ '\S')
  );

ALTER TABLE "known_payers"
  DROP CONSTRAINT "known_payers_identifier_not_blank",
  ADD CONSTRAINT "known_payers_identifier_not_blank" CHECK ("identifier_value" ~ '\S');

ALTER TABLE "complaints"
  DROP CONSTRAINT "complaints_body_not_blank",
  ADD CONSTRAINT "complaints_body_not_blank" CHECK ("body" ~ '\S');

ALTER TABLE "visitor_passes"
  DROP CONSTRAINT "visitor_passes_name_not_blank",
  ADD CONSTRAINT "visitor_passes_name_not_blank" CHECK ("visitor_name" ~ '\S');
