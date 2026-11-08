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

const ask = async (user: ActingUser) => {
  const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
  const { rows } = await importLines(fx, "5000000001", anonymousCredit(BIG));
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
    expect(await loadStaffHome({ db: fx.app, user: meera, now: DEMO_NOW })).toEqual({ complaints: null, unseenSafety: null, statements: null, approvals: null });
  });

  it("a person with no permissions gets no numbers and no reads", async () => {
    const none = { id: priya.id, role: "STAFF" as const, active: true, permissions: [] };
    expect(await loadStaffHome({ db: fx.app, user: none, now: DEMO_NOW })).toEqual({ complaints: null, unseenSafety: null, statements: null, approvals: null });
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
    expect(operations).toBeLessThanOrEqual(10);
  });

  it("a failing count gives null for that card and never throws", async () => {
    const broken = new Proxy(fx.app, {
      get(target, property, receiver) {
        if (property === "$queryRaw") return () => Promise.reject(new Error("boom"));
        return Reflect.get(target, property, receiver);
      },
    });
    const home = await loadStaffHome({ db: broken, user: { id: sanjay.id, role: "STAFF", active: true, permissions: ["complaints:manage", "complaints:duty_manager", "payments:match", "payments:approve"] }, now: DEMO_NOW });
    expect(home).toEqual({ complaints: null, unseenSafety: null, statements: null, approvals: null });
  });

  it("the approver's own requests do not make a strip: Priya (who cannot approve) has no approvals read", async () => {
    expect((await loadStaffHome({ db: fx.app, user: priya, now: DEMO_NOW })).approvals).toBeNull();
  });
});
