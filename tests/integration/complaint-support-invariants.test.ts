import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { SQLSTATE, connect, insertComplaint, insertFlat, insertRow, insertUser, rejectedWith, uniqueRef } from "./db";

let db: Client;
let flatId: string;
let userId: string;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
  userId = await insertUser(db);
});
afterAll(() => db.end());

const newComplaint = () => insertComplaint(db, flatId, userId);
const link = (client: Client, primaryId: string, duplicateId: string) =>
  insertRow(client, "complaint_links", { primary_id: primaryId, duplicate_id: duplicateId, linked_by_id: userId });
const accepted = (id: Promise<string>) => expect(id).resolves.toBeTypeOf("string");

describe("K5 complaint_events, classifications and audit_log are append-only", () => {
  const tables = [
    {
      table: "complaint_events",
      insert: async () =>
        insertRow(db, "complaint_events", { complaint_id: await newComplaint(), event_type: "CREATED" }),
      update: "payload = '{\"changed\": true}'::jsonb",
    },
    {
      table: "classifications",
      insert: async () =>
        insertRow(db, "classifications", { complaint_id: await newComplaint(), source: "RULE", urgency: "NORMAL" }),
      update: "latency_ms = 5",
    },
    {
      table: "audit_log",
      insert: () => insertRow(db, "audit_log", { action: "complaint.created", entity_type: "complaint", entity_id: "c-1" }),
      update: "action = 'tampered'",
    },
  ];

  it.each(tables)("K5 $table rejects UPDATE and leaves the row unchanged", async ({ table, insert, update }) => {
    const id = await insert();
    const before = await db.query(`SELECT row_to_json(t)::text AS row FROM ${table} t WHERE id = $1`, [id]);
    await rejectedWith(db.query(`UPDATE ${table} SET ${update} WHERE id = $1`, [id]), SQLSTATE.restrictViolation);
    const after = await db.query(`SELECT row_to_json(t)::text AS row FROM ${table} t WHERE id = $1`, [id]);
    expect(after.rows[0].row).toBe(before.rows[0].row);
  });

  it.each(tables)("K5 $table rejects DELETE and leaves the row in place", async ({ table, insert }) => {
    const id = await insert();
    await rejectedWith(db.query(`DELETE FROM ${table} WHERE id = $1`, [id]), SQLSTATE.restrictViolation);
    const { rowCount } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
    expect(rowCount).toBe(1);
  });

  it.each(tables)("K5 $table rejects TRUNCATE", async ({ table }) => {
    await rejectedWith(db.query(`TRUNCATE ${table}`), SQLSTATE.restrictViolation, undefined, `${table} is append-only`);
  });

  it.each(tables)("K5 $table still accepts INSERT (append)", async ({ insert }) => {
    await expect(insert()).resolves.toBeTypeOf("string");
  });
});

describe("K6 complaint_links", () => {
  it("K6 duplicate_id is unique: a complaint is a duplicate of at most one primary", async () => {
    const [a, b, c] = [await newComplaint(), await newComplaint(), await newComplaint()];
    await link(db, a, b);
    await rejectedWith(link(db, c, b), SQLSTATE.uniqueViolation, "complaint_links_duplicate_id_key");
  });

  it("K6 one primary may have many duplicates", async () => {
    const [a, b, c] = [await newComplaint(), await newComplaint(), await newComplaint()];
    await accepted(link(db, a, b));
    await accepted(link(db, a, c));
  });

  it("K6 a complaint cannot be a duplicate of itself", async () => {
    const a = await newComplaint();
    await rejectedWith(link(db, a, a), SQLSTATE.checkViolation, "complaint_links_primary_differs_from_duplicate");
  });

  it("K6 order 1: an existing primary cannot become a duplicate", async () => {
    const [a, b, x] = [await newComplaint(), await newComplaint(), await newComplaint()];
    await link(db, a, b);
    await rejectedWith(link(db, x, a), SQLSTATE.checkViolation, undefined, "already a primary");
  });

  it("K6 order 2: an existing duplicate cannot become a primary", async () => {
    const [a, b, c] = [await newComplaint(), await newComplaint(), await newComplaint()];
    await link(db, a, b);
    await rejectedWith(link(db, b, c), SQLSTATE.checkViolation, undefined, "already a duplicate");
  });

  it("K6 an UPDATE cannot create a chain either", async () => {
    const [a, b, c, d] = [await newComplaint(), await newComplaint(), await newComplaint(), await newComplaint()];
    await link(db, a, b);
    const second = await link(db, c, d);
    await rejectedWith(
      db.query("UPDATE complaint_links SET primary_id = $2 WHERE id = $1", [second, b]),
      SQLSTATE.checkViolation,
      undefined,
      "already a duplicate",
    );
  });

  it("K6 concurrent inserts cannot build a chain together (advisory lock)", async () => {
    const [a, b, c] = [await newComplaint(), await newComplaint(), await newComplaint()];
    const other = new Client({ connectionString: inject("testDatabaseUrl") });
    await other.connect();
    try {
      await db.query("BEGIN");
      await link(db, a, b);
      await other.query("BEGIN");
      const second = link(other, b, c).then(
        () => "inserted",
        (e: { code?: string }) => e.code,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await db.query("COMMIT");
      expect(await second).toBe(SQLSTATE.checkViolation);
      await other.query("ROLLBACK");
    } finally {
      await other.end();
    }
  });
});

describe("K7 outbox_jobs and notifications", () => {
  const job = (overrides: Record<string, unknown> = {}) =>
    insertRow(db, "outbox_jobs", { job_type: "SEND_NOTIFICATION", idempotency_key: uniqueRef("job"), ...overrides });
  const notification = (overrides: Record<string, unknown> = {}) =>
    insertRow(db, "notifications", {
      recipient_id: userId,
      kind: "complaint.assigned",
      idempotency_key: uniqueRef("note"),
      ...overrides,
    });

  it("K7 outbox_jobs.idempotency_key is unique", async () => {
    const idempotency_key = uniqueRef("job");
    await job({ idempotency_key });
    await rejectedWith(job({ idempotency_key }), SQLSTATE.uniqueViolation, "outbox_jobs_idempotency_key_key");
    await accepted(job());
  });

  it("K7 notifications.idempotency_key is unique", async () => {
    const idempotency_key = uniqueRef("note");
    await notification({ idempotency_key });
    await rejectedWith(notification({ idempotency_key }), SQLSTATE.uniqueViolation, "notifications_idempotency_key_key");
    await accepted(notification());
  });

  it("K7 NULL case: a NULL idempotency_key is rejected on both tables (NOT NULL)", async () => {
    await rejectedWith(job({ idempotency_key: null }), SQLSTATE.notNullViolation);
    await rejectedWith(notification({ idempotency_key: null }), SQLSTATE.notNullViolation);
  });

  it.each(["DONE", "FAILED"])("K7 a %s job requires finished_at (NULL case rejected)", async (status) => {
    await rejectedWith(
      job({ status, finished_at: null }),
      SQLSTATE.checkViolation,
      "outbox_jobs_finished_has_timestamp",
    );
    await accepted(job({ status, finished_at: "2026-04-02T10:00:00Z" }));
  });

  it.each(["PENDING", "RUNNING"])("K7 a %s job needs no finished_at", async (status) => {
    await accepted(job({ status }));
  });

  it("K7 a SENT notification requires sent_at (NULL case rejected)", async () => {
    await rejectedWith(
      notification({ status: "SENT", sent_at: null }),
      SQLSTATE.checkViolation,
      "notifications_sent_has_timestamp",
    );
    await accepted(notification({ status: "SENT", sent_at: "2026-04-02T10:00:00Z" }));
  });

  it.each(["PENDING", "FAILED"])("K7 a %s notification needs no sent_at", async (status) => {
    await accepted(notification({ status }));
  });

  it("K7 NULL case: a NULL job or notification status is rejected (NOT NULL)", async () => {
    await rejectedWith(job({ status: null }), SQLSTATE.notNullViolation);
    await rejectedWith(notification({ status: null }), SQLSTATE.notNullViolation);
  });
});

describe("K8 classifications.confidence is within [0, 1] when present", () => {
  const classify = async (confidence: number | null) =>
    insertRow(db, "classifications", {
      complaint_id: await newComplaint(),
      source: "LLM",
      urgency: "NORMAL",
      confidence,
    });

  it.each([1.001, 9.999, -0.001])("K8 rejects confidence %f", async (confidence) => {
    await rejectedWith(classify(confidence), SQLSTATE.checkViolation, "classifications_confidence_in_range");
  });

  it.each([0, 0.5, 1])("K8 accepts confidence %f", async (confidence) => {
    await accepted(classify(confidence));
  });

  it("K8 NULL case: a NULL confidence is accepted", async () => {
    await accepted(classify(null));
  });
});

describe("K9 visitor_passes and complaint_affected", () => {
  const visitor = (visitor_name: string | null) =>
    insertRow(db, "visitor_passes", { flat_id: flatId, visitor_name, expected_at: "2026-04-10T09:00:00Z" });

  it.each(["", "   "])("K9 rejects a blank visitor_name %j", async (name) => {
    await rejectedWith(visitor(name), SQLSTATE.checkViolation, "visitor_passes_name_not_blank");
  });

  it("K9 NULL case: a NULL visitor_name is rejected (NOT NULL); a real name is accepted", async () => {
    await rejectedWith(visitor(null), SQLSTATE.notNullViolation);
    await accepted(visitor("Asha (fictional visitor)"));
  });

  it("K9 complaint_affected is unique on (complaint_id, flat_id)", async () => {
    const complaintId = await newComplaint();
    const [flatA, flatB] = [await insertFlat(db), await insertFlat(db)];
    const affect = (flat_id: string) => insertRow(db, "complaint_affected", { complaint_id: complaintId, flat_id });
    await affect(flatA);
    await rejectedWith(affect(flatA), SQLSTATE.uniqueViolation, "complaint_affected_complaint_id_flat_id_key");
    await accepted(affect(flatB));
  });
});
