import type { DemoDataset } from "@/domain/seed/types";
import { uuidFromKey } from "./uuid";

/** One row ready to insert: `key` names it in error messages; `values` follow the table's column list. */
export type SeedRow = { key: string; values: unknown[] };
export type SeedTable = { table: string; columns: string[]; rows: SeedRow[] };

const id = uuidFromKey;
const at = (ms: number) => new Date(ms);
const atOrNull = (ms: number | null) => (ms === null ? null : new Date(ms));
const json = (value: unknown) => JSON.stringify(value);

/**
 * The dataset as database rows, in foreign-key order: a table comes after every
 * table it points at. Money is sent as text so bigint stays exact. Columns the
 * dataset has no value for (latency_ms, output_hash, created_by_id, language) are
 * left out, so the database gives them NULL. The created_at of ledger entries and
 * known payers, which the dataset does not have either, takes the database default.
 */
export function buildSeedTables(d: DemoDataset): SeedTable[] {
  const permissions = d.staff.flatMap((s) => s.permissions.map((permission) => ({ userKey: s.userKey, permission })));

  return [
    {
      table: "users",
      columns: ["id", "phone", "name", "role", "active"],
      rows: d.users.map((u) => ({ key: u.key, values: [id(u.key), u.phone, u.name, u.role, u.active] })),
    },
    {
      table: "user_permissions",
      columns: ["id", "user_id", "permission"],
      rows: permissions.map((p) => {
        const key = `permission:${p.userKey}:${p.permission}`;
        return { key, values: [id(key), id(p.userKey), p.permission] };
      }),
    },
    {
      table: "flats",
      columns: ["id", "code", "tower", "number", "area_sqft"],
      rows: d.flats.map((f) => ({ key: f.key, values: [id(f.key), f.code, f.tower, f.number, f.areaSqft] })),
    },
    {
      table: "flat_members",
      columns: ["id", "flat_id", "user_id", "relation", "starts_on", "ends_on"],
      rows: d.members.map((m) => {
        const key = `member:${m.flatKey}:${m.userKey}:${m.startsOn}`;
        return { key, values: [id(key), id(m.flatKey), id(m.userKey), m.relation, m.startsOn, m.endsOn] };
      }),
    },
    {
      table: "society_settings",
      columns: ["key", "value"],
      rows: d.settings.map((s) => ({ key: s.key, values: [s.key, json(s.value)] })),
    },
    {
      table: "bills",
      columns: ["id", "flat_id", "period", "issued_on", "due_on", "amount_paise", "area_sqft_snapshot", "rate_paise_per_sqft"],
      rows: d.bills.map((b) => ({
        key: b.key,
        values: [id(b.key), id(b.flatKey), b.period, b.issuedOn, b.dueOn, b.amountPaise.toString(), b.areaSqftSnapshot, b.ratePaisePerSqft],
      })),
    },
    {
      table: "ledger_entries",
      columns: ["id", "flat_id", "entry_type", "direction", "amount_paise", "effective_date", "bill_id", "reference", "idempotency_key", "note"],
      rows: d.ledgerEntries.map((e) => ({
        key: e.key,
        values: [id(e.key), id(e.flatKey), e.entryType, e.direction, e.amountPaise.toString(), e.effectiveDate, e.billKey === null ? null : id(e.billKey), e.reference, e.idempotencyKey, e.note],
      })),
    },
    {
      table: "complaint_categories",
      columns: ["id", "code", "name", "default_assignee_id"],
      rows: d.categories.map((c) => ({ key: c.key, values: [id(c.key), c.code, c.name, id(c.defaultAssigneeUserKey)] })),
    },
    {
      table: "complaints",
      columns: [
        "id", "flat_id", "raised_by_id", "body", "category_id", "urgency", "safety_flag", "status", "assignee_id",
        "response_due_at", "first_response_at", "pending_confirmation_at", "closed_at", "close_kind", "rating",
        "reopen_count", "needs_review", "created_at",
      ],
      rows: d.complaints.map((c) => ({
        key: c.key,
        values: [
          id(c.key), id(c.flatKey), id(c.raisedByUserKey), c.body, id(`category:${c.categoryCode}`), c.urgency, c.safetyFlag, c.status,
          c.assigneeUserKey === null ? null : id(c.assigneeUserKey), at(c.responseDueAt), atOrNull(c.firstResponseAt),
          atOrNull(c.pendingConfirmationAt), atOrNull(c.closedAt), c.closeKind, c.rating, c.reopenCount, c.needsReview, at(c.createdAt),
        ],
      })),
    },
    {
      table: "complaint_events",
      columns: ["id", "complaint_id", "event_type", "actor_id", "payload", "created_at"],
      rows: d.events.map((e) => ({
        key: e.key,
        values: [id(e.key), id(e.complaintKey), e.type, e.actorUserKey === null ? null : id(e.actorUserKey), json(e.payload), at(e.createdAt)],
      })),
    },
    {
      table: "classifications",
      columns: ["id", "complaint_id", "source", "category_id", "urgency", "confidence", "created_at"],
      rows: d.classifications.map((k) => {
        const key = `classification:${k.complaintKey}`;
        return { key, values: [id(key), id(k.complaintKey), k.source, id(`category:${k.categoryCode}`), k.urgency, k.confidence === null ? null : k.confidence.toFixed(3), at(k.createdAt)] };
      }),
    },
    {
      table: "complaint_links",
      columns: ["id", "primary_id", "duplicate_id", "similarity", "linked_by_id", "created_at"],
      rows: d.links.map((l) => {
        const key = `link:${l.duplicateKey}`;
        return { key, values: [id(key), id(l.primaryKey), id(l.duplicateKey), l.similarity.toFixed(3), l.linkedByUserKey === null ? null : id(l.linkedByUserKey), at(l.createdAt)] };
      }),
    },
    {
      table: "complaint_affected",
      columns: ["id", "complaint_id", "flat_id", "created_at"],
      rows: d.affected.map((a) => {
        const key = `affected:${a.complaintKey}:${a.flatKey}`;
        return { key, values: [id(key), id(a.complaintKey), id(a.flatKey), at(a.createdAt)] };
      }),
    },
    {
      table: "visitor_passes",
      columns: ["id", "flat_id", "visitor_name", "expected_at", "purpose", "status"],
      rows: d.visitorPasses.map((v, i) => {
        const key = `visitor:${i}`;
        return { key, values: [id(key), id(v.flatKey), v.visitorName, at(v.expectedAt), v.purpose, v.status] };
      }),
    },
    {
      table: "known_payers",
      columns: ["id", "flat_id", "identifier_type", "identifier_value", "source", "added_by_id"],
      rows: d.knownPayers.map((k) => {
        const key = `payer:${k.flatKey}:${k.identifierValue}`;
        return { key, values: [id(key), id(k.flatKey), k.identifierType, k.identifierValue, k.source, k.addedByUserKey === null ? null : id(k.addedByUserKey)] };
      }),
    },
    {
      table: "notifications",
      columns: ["id", "recipient_id", "kind", "body", "status", "idempotency_key", "created_at", "sent_at", "read_at"],
      rows: d.notifications.map((n, i) => {
        const key = `notification:${i}`;
        return { key, values: [id(key), id(n.userKey), n.kind, json({ text: n.body }), "SENT", `seed:${key}`, at(n.createdAt), at(n.createdAt), atOrNull(n.readAt)] };
      }),
    },
  ];
}
