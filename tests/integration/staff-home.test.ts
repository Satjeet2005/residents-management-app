import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { loadStaffHome } from "@/server/staff/home-data";
import { type MatchResult, postManualMatch } from "@/server/statements/manual";
import type { ActingUser } from "@/server/statements/manual-core";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { anonymousCredit, importLines, seedStaff } from "./reconciliation-helpers";

/**
 * SH1: the numbers of the staff home (D187) through the APP role, each compared with SQL written in this test (a different way of asking: NOT EXISTS where the loader
 * takes the latest request, plain predicates where the loader uses the board's view predicates). The database is the seeded one, then a statement of two rows is imported and three more, each
 * with one large credit that Priya, Rahul and Priya asked a second approver for (so Rahul's own request must not count for Rahul).
 */
let fx: PaymentsFixture;
let priya: ActingUser;
let rahul: ActingUser;
let meera: ActingUser;
let kavita: ActingUser;
let sanjay: ActingUser;
const BIG = 2_600_000n;
const NO_NUMBERS = { complaints: null, unseenSafety: null, statements: null, approvals: null, paymentRows: null, complaintRows: null };

const ask = async (user: ActingUser, amount = BIG) => {
  const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
  const { rows } = await importLines(fx, "5000000001", anonymousCredit(amount));
  const row = rows[0];
  const result: MatchResult = await postManualMatch({ db: fx.app, user, rowId: row.id, flatCode: resident.flatCode, reason: "Large transfer, owner confirmed", rememberPayer: false, expectedVersion: row.version, now: DEMO_NOW });
  expect(result.status).toBe("AWAITING_APPROVAL");
  return row;
};

beforeAll(async () => {
  fx = await createPaymentsFixture();
  [priya, rahul, meera, kavita, sanjay] = await Promise.all(["5000000001", "5000000002", "5000000003", "5000000004", "5000000005"].map((phone) => seedStaff(fx, phone)));
  await importLines(fx, "5000000001", anonymousCredit(12_300n), anonymousCredit(45_600n));
  await ask(priya);
  await ask(rahul);
  await ask(priya);
  await ask(rahul, 2_900_000n);
}, 240_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const one = async <T>(sql: string, ...params: unknown[]): Promise<T> => (await fx.owner.$queryRawUnsafe<T[]>(sql, ...params))[0];

describe("SH1 the staff home's numbers equal independent SQL", () => {
  it("Priya: the queued and awaiting totals over ALL imports, and the newest import", async () => {
    const home = await loadStaffHome({ db: fx.app, user: priya, now: DEMO_NOW });
    const sql = await one<{ q: number; a: number }>(`SELECT (SELECT count(*) FROM bank_rows WHERE state = 'QUEUED')::int AS q, (SELECT count(*) FROM bank_rows WHERE state = 'AWAITING_APPROVAL')::int AS a`);
    expect(home.statements?.needsPerson).toBe(sql.q);
    expect(home.statements?.awaitingApproval).toBe(sql.a);
    expect(sql.a).toBeGreaterThanOrEqual(3);
    const newest = await one<{ id: string; filename: string; rows_read: number }>(`SELECT id::text, filename, rows_read FROM statement_imports ORDER BY uploaded_at DESC, id LIMIT 1`);
    expect(home.statements?.newest).toMatchObject({ importId: newest.id, filename: newest.filename, rowsRead: newest.rows_read });
    expect(home.approvals).toBeNull();
    expect(home.complaints).toBeNull();
    expect(home.unseenSafety).toBeNull();
  });

  it("Rahul: the approvals waiting for HIM exclude the ones he requested, over all imports, and link to the newest import that has some", async () => {
    const home = await loadStaffHome({ db: fx.app, user: rahul, now: DEMO_NOW });
    const mine = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM bank_rows r WHERE r.state = 'AWAITING_APPROVAL' AND NOT EXISTS (SELECT 1 FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' AND m.decided_by_id = $1::uuid)`,
      rahul.id,
    );
    const everything = await one<{ n: number }>(`SELECT count(*)::int AS n FROM bank_rows WHERE state = 'AWAITING_APPROVAL'`);
    expect(home.approvals?.waiting).toBe(mine.n);
    expect(mine.n).toBeLessThan(everything.n);
    expect(mine.n).toBeGreaterThanOrEqual(2);
    const newestWithAny = await one<{ id: string }>(
      `SELECT i.id::text FROM statement_imports i WHERE EXISTS (SELECT 1 FROM bank_rows r WHERE r.import_id = i.id AND r.state = 'AWAITING_APPROVAL' AND NOT EXISTS (SELECT 1 FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' AND m.decided_by_id = $1::uuid)) ORDER BY i.uploaded_at DESC, i.id LIMIT 1`,
      rahul.id,
    );
    expect(home.approvals?.importId).toBe(newestWithAny.id);
    expect(home.approvals?.importId).not.toBeNull();
  });

  it("Kavita and Sanjay: the board's needs-action and overdue counts equal predicates written here", async () => {
    for (const user of [kavita, sanjay]) {
      const home = await loadStaffHome({ db: fx.app, user, now: DEMO_NOW });
      const now = new Date(DEMO_NOW).toISOString();
      const sql = await one<{ needs: number; overdue: number }>(
        `SELECT
           (count(*) FILTER (WHERE c.status <> 'CLOSED' AND (
              (c.safety_flag AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack'))
              OR c.assignee_id IS NULL
              OR (c.needs_review AND c.status = 'NEW')
              OR (c.assignee_id = $1::uuid AND ((c.response_due_at < $2::timestamptz AND c.first_response_at IS NULL) OR c.status = 'REOPENED')))))::int AS needs,
           (count(*) FILTER (WHERE c.status <> 'CLOSED' AND c.response_due_at < $2::timestamptz AND c.first_response_at IS NULL))::int AS overdue
         FROM complaints c`,
        user.id,
        now,
      );
      expect(home.complaints).toEqual({ needsAction: sql.needs, overdue: sql.overdue });
      expect(home.statements).toBeNull();
    }
  });

  it("Sanjay: the unseen safety count equals the SQL; Kavita (not the duty manager) gets none", async () => {
    const sql = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM complaints c WHERE c.safety_flag AND c.status <> 'CLOSED' AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack')`,
    );
    expect((await loadStaffHome({ db: fx.app, user: sanjay, now: DEMO_NOW })).unseenSafety).toBe(sql.n);
    expect((await loadStaffHome({ db: fx.app, user: kavita, now: DEMO_NOW })).unseenSafety).toBeNull();
  });

  it("Meera (committee only) gets no numbers at all", async () => {
    expect(await loadStaffHome({ db: fx.app, user: meera, now: DEMO_NOW })).toEqual(NO_NUMBERS);
  });

  it("a person with no permissions gets no numbers and no reads", async () => {
    const none = { id: priya.id, role: "STAFF" as const, active: true, permissions: [] };
    expect(await loadStaffHome({ db: fx.app, user: none, now: DEMO_NOW })).toEqual(NO_NUMBERS);
  });
});

describe("SH2 cost and failure", () => {
  it("runs a constant, small number of database operations (the committee report is not loaded: it takes 10 on its own)", async () => {
    let operations = 0;
    const counted = fx.app.$extends({
      query: {
        $allOperations({ args, query }) {
          operations += 1;
          return query(args);
        },
      },
    }) as unknown as typeof fx.app;
    await loadStaffHome({ db: counted, user: rahul, now: DEMO_NOW });
    expect(operations).toBeLessThanOrEqual(8);
    const all = { id: sanjay.id, role: "STAFF" as const, active: true, permissions: ["payments:match", "payments:approve", "complaints:manage", "complaints:duty_manager", "reports:view"] };
    operations = 0;
    await loadStaffHome({ db: counted, user: all, now: DEMO_NOW });
    expect(operations).toBeLessThanOrEqual(12);
  });

  it("a failing count gives null for that card and never throws", async () => {
    const broken = new Proxy(fx.app, {
      get(target, property, receiver) {
        if (property === "$queryRaw") return () => Promise.reject(new Error("boom"));
        return Reflect.get(target, property, receiver);
      },
    });
    const home = await loadStaffHome({ db: broken, user: { id: sanjay.id, role: "STAFF", active: true, permissions: ["complaints:manage", "complaints:duty_manager", "payments:match", "payments:approve"] }, now: DEMO_NOW });
    expect(home).toEqual(NO_NUMBERS);
  });

  it("the approver's own requests do not make a strip: Priya (who cannot approve) has no approvals read", async () => {
    expect((await loadStaffHome({ db: fx.app, user: priya, now: DEMO_NOW })).approvals).toBeNull();
  });
});

type Candidate = { id: string; import_id: string; amount: bigint; state: string; uploaded: Date; requester: string | null; credit: boolean };

/** Every row that could be listed, with who last asked for approval, read plainly; the order and the cut are then done here in JavaScript, not in SQL. */
const candidates = async (): Promise<Candidate[]> =>
  fx.owner.$queryRawUnsafe<Candidate[]>(
    `SELECT r.id::text AS id, r.import_id::text AS import_id, GREATEST(r.credit_paise, r.debit_paise) AS amount, r.state::text AS state, i.uploaded_at AS uploaded, r.credit_paise > 0 AS credit,
       (SELECT m.decided_by_id::text FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' ORDER BY m.decided_at DESC, m.id DESC LIMIT 1) AS requester
     FROM bank_rows r JOIN statement_imports i ON i.id = r.import_id WHERE r.state IN ('QUEUED', 'AWAITING_APPROVAL')`,
  );
const byAmount = (a: Candidate, b: Candidate): number => (a.amount === b.amount ? b.uploaded.getTime() - a.uploaded.getTime() || a.id.localeCompare(b.id) : a.amount > b.amount ? -1 : 1);

describe("SH10 the Next up payments, in the stated order, equal a JavaScript ordering of plain SQL rows (D237)", () => {
  beforeAll(async () => {
    await importLines(fx, "5000000001", anonymousCredit(31_000n), anonymousCredit(8_500n), anonymousCredit(45_600n), anonymousCredit(12_300n));
  }, 60_000);

  it("Rahul: the requests of others first (his own never), the biggest first, then the biggest rows that need a person, at most three", async () => {
    const all = await candidates();
    const others = all.filter((r) => r.state === "AWAITING_APPROVAL" && r.requester !== rahul.id).sort(byAmount);
    const needs = all.filter((r) => r.state === "QUEUED").sort(byAmount);
    const expected = [...others, ...needs].slice(0, 3).map((r) => r.id);
    const own = all.filter((r) => r.state === "AWAITING_APPROVAL" && r.requester === rahul.id);
    expect(own.length).toBeGreaterThanOrEqual(2);
    expect(own.some((r) => r.amount > others[0].amount)).toBe(true);
    expect(others.length).toBeGreaterThanOrEqual(2);
    const rows = (await loadStaffHome({ db: fx.app, user: rahul, now: DEMO_NOW })).paymentRows ?? [];
    expect(rows.map((r) => r.id)).toEqual(expected);
    expect(rows.map((r) => r.id).filter((id) => own.some((o) => o.id === id))).toEqual([]);
    expect(rows.map((r) => r.lane)).toEqual(expected.map((id) => (others.some((o) => o.id === id) ? "AWAITING_APPROVAL" : "NEEDS_YOU")));
    expect(rows.length).toBe(3);
  });

  it("Priya (cannot approve): only the rows that need a person, biggest first, at most three; none that wait for approval", async () => {
    const all = await candidates();
    expect(all.filter((r) => r.state === "QUEUED").length).toBeGreaterThan(3);
    const expected = all.filter((r) => r.state === "QUEUED").sort(byAmount).slice(0, 3);
    const rows = (await loadStaffHome({ db: fx.app, user: priya, now: DEMO_NOW })).paymentRows ?? [];
    expect(rows.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(rows.every((r) => r.lane === "NEEDS_YOU")).toBe(true);
    expect(rows.map((r) => r.amountPaise)).toEqual(expected.map((r) => r.amount.toString()));
  });

  it("each row carries its own import, the flat the matcher found (or none) and the second-approver flag from the society threshold", async () => {
    const threshold = BigInt((await one<{ v: string }>(`SELECT (value #>> '{}') AS v FROM society_settings WHERE key = 'approval_threshold_paise'`)).v);
    const rows = (await loadStaffHome({ db: fx.app, user: rahul, now: DEMO_NOW })).paymentRows ?? [];
    for (const row of rows) {
      const stored = await one<{ import_id: string; flat: string | null; credit: boolean }>(`SELECT import_id::text, parsed #>> '{decision,candidates,0,flatCode}' AS flat, credit_paise > 0 AS credit FROM bank_rows WHERE id = $1::uuid`, row.id);
      expect(row.importId).toBe(stored.import_id);
      expect(row.bestFlat).toBe(stored.flat);
      expect(row.needsSecondApprover).toBe(stored.credit && BigInt(row.amountPaise) >= threshold);
    }
    expect(rows.some((r) => r.needsSecondApprover)).toBe(true);
  });

  it("the rows hold no narration, no phone and no payer name: the type has none of those fields", async () => {
    const rows = (await loadStaffHome({ db: fx.app, user: rahul, now: DEMO_NOW })).paymentRows ?? [];
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["amountPaise", "bestFlat", "confidence", "direction", "id", "importId", "lane", "needsSecondApprover", "txnDate"]);
  });
});

type Case = { id: string; created: Date; urgency: string; safety: boolean; unseen: boolean; due: Date | null; status: string };
const needsActionCases = async (userId: string, now: string): Promise<Case[]> =>
  fx.owner.$queryRawUnsafe<Case[]>(
    `SELECT c.id::text AS id, c.created_at AS created, c.urgency::text AS urgency, c.safety_flag AS safety, c.response_due_at AS due, c.status::text AS status,
       (c.safety_flag AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack')) AS unseen
     FROM complaints c
     WHERE c.status <> 'CLOSED' AND (
       (c.safety_flag AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack'))
       OR c.assignee_id IS NULL OR (c.needs_review AND c.status = 'NEW')
       OR (c.assignee_id = $1::uuid AND ((c.response_due_at < $2::timestamptz AND c.first_response_at IS NULL) OR c.status = 'REOPENED')))`,
    userId,
    now,
  );
const band = (c: Case): number => (c.unseen ? 0 : c.urgency === "CRITICAL" || c.urgency === "HIGH" ? 1 : 2);
const boardOrder = (a: Case, b: Case): number => band(a) - band(b) || (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) || b.created.getTime() - a.created.getTime() || b.id.localeCompare(a.id);

describe("SH11 the Next up complaints (D237)", () => {
  beforeAll(async () => {
    const resident = await fx.makeResident({});
    const old = (days: number) => new Date(DEMO_NOW - days * 86_400_000);
    for (const [index, days] of [[1, 40], [2, 30], [3, 20], [4, 10]] as const) {
      await fx.owner.complaint.create({ data: { flatId: resident.flatId, raisedById: resident.user.id, body: `Gas smell number ${index}`, safetyFlag: true, urgency: "CRITICAL", createdAt: old(days) } });
    }
  }, 60_000);

  it("Sanjay: the unseen safety complaints first, oldest first, then the board's order; at most three", async () => {
    const cases = await needsActionCases(sanjay.id, new Date(DEMO_NOW).toISOString());
    const unseen = cases.filter((c) => c.unseen).sort((a, b) => a.created.getTime() - b.created.getTime() || a.id.localeCompare(b.id));
    expect(unseen.length).toBeGreaterThanOrEqual(4);
    const rows = (await loadStaffHome({ db: fx.app, user: sanjay, now: DEMO_NOW })).complaintRows ?? [];
    expect(rows.map((r) => r.id)).toEqual(unseen.slice(0, 3).map((c) => c.id));
    expect(rows.every((r) => r.safety)).toBe(true);
  });

  it("Kavita (not the duty manager): the board's Needs action order, at most three", async () => {
    const cases = (await needsActionCases(kavita.id, new Date(DEMO_NOW).toISOString())).sort(boardOrder);
    expect(cases.length).toBeGreaterThan(3);
    const rows = (await loadStaffHome({ db: fx.app, user: kavita, now: DEMO_NOW })).complaintRows ?? [];
    expect(rows.map((r) => r.id)).toEqual(cases.slice(0, 3).map((c) => c.id));
  });

  it("a row holds the flat, the category and a one-line title, and no resident name", async () => {
    const rows = (await loadStaffHome({ db: fx.app, user: sanjay, now: DEMO_NOW })).complaintRows ?? [];
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["category", "flatCode", "id", "responseDueAt", "safety", "sla", "title", "urgency"]);
      const stored = await one<{ code: string; body: string }>(`SELECT f.code, c.body FROM complaints c JOIN flats f ON f.id = c.flat_id WHERE c.id = $1::uuid`, row.id);
      expect(row.flatCode).toBe(stored.code);
      expect(stored.body.startsWith(row.title.replace("…", ""))).toBe(true);
      expect(row.title).not.toContain("\n");
    }
  });

  it("a person who may not manage complaints gets no complaint rows", async () => {
    expect((await loadStaffHome({ db: fx.app, user: priya, now: DEMO_NOW })).complaintRows).toBeNull();
    expect((await loadStaffHome({ db: fx.app, user: meera, now: DEMO_NOW })).paymentRows).toBeNull();
  });
});
