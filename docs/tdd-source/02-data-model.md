FACTS ONLY. The human writes the narrative and the reasoning.

# 02 Data model

Source: `prisma/schema.prisma`, 26 models. Table below is the printed output of `npm run tdd:data-model` (`scripts/tdd-data-model.ts`).

How the script counts: a column is a field whose type is not a model. Enum fields count as columns. A relation is a field whose type is a model, including the back-side list.

## Models

| Model | Table | Columns | Relations | Purpose |
|---|---|---|---|---|
| Flat | flats | 5 | 10 | A flat, the billing unit. Read by bills, ledger, complaints (`src/server/home/queries.ts`). |
| User | users | 5 | 17 | A resident or staff person, found by phone at login (`src/server/auth/otp-service.ts`). |
| FlatMember | flat_members | 6 | 2 | Links a user to a flat with a relation and dates (`src/server/home/queries.ts`). |
| UserPermission | user_permissions | 3 | 1 | Staff permission strings, read at login and by complaint staff lookups (`src/server/complaints/staff.ts`). |
| Session | sessions | 6 | 1 | Database session with a hashed token that can be revoked (`src/server/auth/session-service.ts`). |
| OtpCode | otp_codes | 8 | 0 | One-time login codes stored as keyed hashes (`src/server/auth/otp-service.ts`). |
| SocietySetting | society_settings | 2 | 0 | Key and value settings such as the approval threshold (`src/server/statements/positions.ts`). |
| Bill | bills | 8 | 5 | A monthly maintenance bill for a flat (`src/server/statements/positions.ts`). |
| LedgerEntry | ledger_entries | 15 | 11 | Append-only money ledger: charges and payments (`src/server/statements/import.ts`). |
| PaymentAttempt | payment_attempts | 14 | 7 | One online payment attempt on a bill (`src/server/payments/initiate.ts`). |
| StatementImport | statement_imports | 7 | 2 | One uploaded bank statement file (`src/server/statements/import.ts`). |
| BankRow | bank_rows | 16 | 7 | One row of a bank statement, in exactly one state (`src/server/statements/import.ts`). |
| PaymentMatch | payment_matches | 11 | 4 | Append-only log of match decisions on bank rows (`src/server/statements/manual.ts`). |
| KnownPayer | known_payers | 7 | 2 | Payer identifiers tied to a flat, used as a matching signal (`src/server/statements/context.ts`). |
| AccountsQueueItem | accounts_queue_items | 9 | 3 | Work queue for accounts: bank rows and unresolved payments (`src/server/statements/manual-core.ts`). |
| ComplaintCategory | complaint_categories | 4 | 3 | Complaint categories with a default assignee (`src/server/complaints/create.ts`). |
| Complaint | complaints | 20 | 9 | A resident complaint with urgency, status and closure fields (`src/server/complaints/create.ts`). |
| ComplaintEvent | complaint_events | 6 | 2 | Append-only event history of a complaint (`src/server/complaints/events.ts`). |
| Classification | classifications | 9 | 2 | Append-only classifier result for a complaint (`src/server/complaints/create.ts`). |
| ComplaintLink | complaint_links | 6 | 3 | Links a duplicate complaint to a primary. Only seed, grants and tests use it (no `src/server` writer found). UNVERIFIED: runtime use. |
| ComplaintAffected | complaint_affected | 4 | 2 | Other flats affected by a complaint. Only seed, grants and tests use it (no `src/server` writer found). UNVERIFIED: runtime use. |
| OutboxJob | outbox_jobs | 10 | 0 | Outbox job rows. Nothing in `src` reads or writes them; `docs/known-limitations.md` says nothing processes the outbox. |
| Notification | notifications | 9 | 1 | A notification row, written for a safety complaint (`src/server/complaints/create.ts`). |
| AuditLog | audit_log | 7 | 1 | Append-only audit trail (`src/server/auth/audit.ts`). |
| VisitorPass | visitor_passes | 6 | 1 | Seed data only: no resident screen shows these rows and no code reads them. |
| ErrorEvent | error_events | 20 | 0 | Unexpected-error log, insert-only for the app (`src/server/error-log.ts`). |

## Database-enforced rules

Migrations in `prisma/migrations`. Short names: A = `20261104080217_init_schema`, B = `20261104083542_bank_statements_and_matching`, C = `20261104091653_complaints_outbox_audit_visitors`, D = `20261104092013_blank_checks_include_tabs_and_newlines`, E = `20261104094500_same_flat_composite_foreign_keys`, F = `20261106040000_otp_request_ip_hash_and_attempt_bounds`, G = `20261107090000_error_events`. Each file below is named `migration.sql`.

| Rule | Migration file path | Plain words |
|---|---|---|
| Ledger append-only (I3), trigger `ledger_entries_no_update_delete` and `ledger_entries_no_truncate` | `prisma/migrations/20261104080217_init_schema/migration.sql` | UPDATE, DELETE and TRUNCATE on the ledger raise an error. |
| Ledger amount above zero (I1), check `ledger_entries_amount_paise_positive` | `prisma/migrations/20261104080217_init_schema/migration.sql` | Amounts are unsigned and positive. |
| Entry type fixes direction (I2), check `ledger_entries_type_direction` | `prisma/migrations/20261104080217_init_schema/migration.sql` | BILL and LATE_FEE are charges. PAYMENT is a payment. |
| Reversal names its target (I5), check `ledger_entries_reversal_has_target` | `prisma/migrations/20261104080217_init_schema/migration.sql` | A reversal must point at an entry. |
| One reversal per entry, unique index `ledger_entries_reverses_entry_id_key` | `prisma/migrations/20261104080217_init_schema/migration.sql` | An entry can be reversed at most once. |
| Unique ledger reference and idempotency key | `prisma/migrations/20261104080217_init_schema/migration.sql` | The same reference or key cannot post twice. |
| Adjustment needs a note, check `ledger_entries_adjustment_has_note` | `prisma/migrations/20261104092013_blank_checks_include_tabs_and_newlines/migration.sql` | A blank or whitespace note is refused. This replaces the first version in A. |
| One unresolved attempt per bill (I6), partial unique index `payment_attempts_one_unresolved_per_bill` | `prisma/migrations/20261104080217_init_schema/migration.sql` | Only one INITIATED or PROCESSING attempt per bill. |
| Unique gateway reference, index `payment_attempts_gateway_reference_key` | `prisma/migrations/20261104080217_init_schema/migration.sql` | A gateway reference is used by one attempt. |
| Released attempt has a reason (I7), check `payment_attempts_released_has_reason` | `prisma/migrations/20261104092013_blank_checks_include_tabs_and_newlines/migration.sql` | A RELEASED attempt needs a non-blank reason. |
| Bill rules: positive amount, due date not before issue, period is the 1st | `prisma/migrations/20261104080217_init_schema/migration.sql` | Checks on `bills`. |
| One bill per flat per period, index `bills_flat_id_period_key` | `prisma/migrations/20261104080217_init_schema/migration.sql` | A flat gets one bill each month. |
| One PAYMENT per bank row (J6), partial unique index `ledger_entries_one_payment_per_bank_row` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | A bank row funds at most one PAYMENT entry. A reversal may reuse the row. |
| Idempotent row key (J1), unique index `bank_rows_dedupe_key_key` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | The same bank row cannot be stored twice. |
| One side positive (J2), check `bank_rows_exactly_one_side_positive` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | A bank row is a credit or a debit, not both. |
| State matches links (J3), check `bank_rows_state_matches_links` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | Matched rows have a flat and a ledger entry. Queued, awaiting and ignored rows have no entry. |
| Match log append-only (J4), triggers `payment_matches_no_update_delete` and `payment_matches_no_truncate` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | Decisions cannot be changed or deleted. |
| Approver differs from decider (J5), check `payment_matches_approver_differs` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | Nobody approves their own match. |
| Human decision needs actor and reason (J5), check `payment_matches_human_decision_has_actor_and_reason` | `prisma/migrations/20261104092013_blank_checks_include_tabs_and_newlines/migration.sql` | Manual decisions name a person and a non-blank reason. |
| Automatic decision has no actor (J5), check `payment_matches_auto_has_no_actor` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | An AUTO decision has no human actor. |
| Queue item points at the right target (J7), check `accounts_queue_items_reference_matches_type` | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | A BANK_ROW item has a row. An UNRESOLVED_PAYMENT item has an attempt. |
| One open queue item per bank row and per attempt (J7), two partial unique indexes | `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql` | No duplicate open work for the same target. |
| Resolved queue item has who, when and why (J7), check `accounts_queue_items_resolved_has_who_when_why` | `prisma/migrations/20261104092013_blank_checks_include_tabs_and_newlines/migration.sql` | A resolved item records who, when and why. |
| Known payer not blank, unique per type, value and flat | `prisma/migrations/20261104092013_blank_checks_include_tabs_and_newlines/migration.sql` | Blank check. The unique index is in B. |
| Same-flat foreign keys (L1), composite keys on attempts, ledger entries and bank rows | `prisma/migrations/20261104094500_same_flat_composite_foreign_keys/migration.sql` | A row cannot point at a bill, attempt or entry of another flat. |
| Safety complaint is CRITICAL (K1), check `complaints_safety_requires_critical` | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | A safety-flagged complaint must have urgency CRITICAL. |
| Safety complaint never auto-closes (K2), check `complaints_safety_never_auto_closes` | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | Close kind is empty or DUTY_MANAGER for a safety complaint. |
| Status and closure agree (K3), checks `complaints_closure_matches_status` and `complaints_pending_has_timestamp` | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | CLOSED has a time and a kind. Other statuses have neither. |
| Rating rules (K4), checks `complaints_rating_in_range` and `complaints_rating_only_when_confirmed_close` | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | Rating is 1 to 5 and only on a CONFIRMED close. |
| Reopen count checks | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | Count is not negative. A REOPENED complaint has a count of at least 1. |
| Complaint body not blank, check `complaints_body_not_blank` | `prisma/migrations/20261104092013_blank_checks_include_tabs_and_newlines/migration.sql` | Replaces the first version in C. |
| Complaint events, classifications and audit log append-only (K5), six triggers | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | UPDATE, DELETE and TRUNCATE raise an error. |
| Duplicate links (K6), check and trigger `complaint_links_no_chains` | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | No self link. A complaint cannot be both primary and duplicate. |
| One link per duplicate, unique index `complaint_links_duplicate_id_key` | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | A duplicate has at most one primary. |
| Idempotency keys (K7), unique indexes on `outbox_jobs` and `notifications`; finished job and sent notification carry a time | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | The same job or notification key cannot repeat. |
| Classifier confidence in range (K8), check `classifications_confidence_in_range` | `prisma/migrations/20261104091653_complaints_outbox_audit_visitors/migration.sql` | Confidence is between 0 and 1 when present. |
| Visitor name not blank, check `visitor_passes_name_not_blank` | `prisma/migrations/20261104092013_blank_checks_include_tabs_and_newlines/migration.sql` | Replaces the first version in C. |
| OTP attempts bounded, check `otp_codes_attempts_bounded` | `prisma/migrations/20261106040000_otp_request_ip_hash_and_attempt_bounds/migration.sql` | Attempts stay between 0 and 100. |
| Error log limits, checks on level, source, message length, stack length and suppressed count | `prisma/migrations/20261107090000_error_events/migration.sql` | Fixed level and source words. Message at most 500 characters. Stack at most 4000. |
| Unique error reference, index `error_events_ref_key` | `prisma/migrations/20261107090000_error_events/migration.sql` | Each error reference is unique. |

## Tests that cover these rules

Test files by name, found in `tests/integration`: `ledger-invariants.test.ts`, `payment-attempt-invariants.test.ts`, `bank-rows-invariants.test.ts`, `payment-matches-invariants.test.ts`, `queue-and-payers-invariants.test.ts`, `same-flat-invariants.test.ts`, `complaints-invariants.test.ts`, `complaint-support-invariants.test.ts`, `truncate.test.ts`.

UNVERIFIED: which exact test covers which rule line was not read test by test.
UNVERIFIED: runtime use of `complaint_links`, `complaint_affected` and `outbox_jobs`, see the Purpose column.
