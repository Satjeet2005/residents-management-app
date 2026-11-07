import { describe, expect, it } from "vitest";
import {
  type LifecycleAction,
  type LifecycleFields,
  type LifecycleState,
  TRANSITIONS,
  applyTransition,
  defaultLifecycleSettings,
  defaultSlaMinutes,
  isValidReason,
  responseDueAt,
  slaState,
} from "@/domain/complaints/lifecycle";
import type { ComplaintStatus } from "@/domain/complaints/step";
import { URGENCIES } from "@/domain/complaints/taxonomy";
import { createPrng } from "@/domain/seed/prng";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 6, 0, 0);
const STATUSES: ComplaintStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "CLOSED", "REOPENED"];

type Row = LifecycleState & { urgency: (typeof URGENCIES)[number] };

/** The database CHECKs of migration 20261104091653, as pure predicates on a row (K1 to K4). */
const K1 = (r: Row): boolean => !r.safetyFlag || r.urgency === "CRITICAL";
const K2 = (r: Row): boolean => !r.safetyFlag || r.closeKind === null || r.closeKind === "DUTY_MANAGER";
const K3 = (r: Row): boolean =>
  (r.status === "CLOSED" && r.closedAt !== null && r.closeKind !== null) || (r.status !== "CLOSED" && r.closedAt === null && r.closeKind === null);
const K3b = (r: Row): boolean => r.status !== "PENDING_CONFIRMATION" || r.pendingConfirmationAt !== null;
const K4 = (r: Row): boolean => r.rating === null || (r.rating >= 1 && r.rating <= 5 && r.status === "CLOSED" && r.closeKind === "CONFIRMED");
const K4b = (r: Row): boolean => r.reopenCount >= 0 && (r.status !== "REOPENED" || r.reopenCount >= 1);
const violations = (r: Row): string[] => Object.entries({ K1, K2, K3, K3b, K4, K4b }).filter(([, check]) => !check(r)).map(([name]) => name);

const fresh = (overrides: Partial<Row> = {}): Row => ({
  status: "NEW",
  closedAt: null,
  closeKind: null,
  pendingConfirmationAt: null,
  reopenCount: 0,
  rating: null,
  firstResponseAt: null,
  safetyFlag: false,
  urgency: "NORMAL",
  ...overrides,
});

const apply = (row: Row, action: LifecycleAction, now = T0) => applyTransition(row, action, now);
const fieldsOf = (row: Row, action: LifecycleAction, now = T0): LifecycleFields => {
  const result = apply(row, action, now);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.fields;
};
const pending = (overrides: Partial<Row> = {}): Row => fresh({ status: "PENDING_CONFIRMATION", pendingConfirmationAt: T0, firstResponseAt: T0, ...overrides });
const closed = (kind: "CONFIRMED" | "AUTO_CLOSED" | "DUTY_MANAGER", overrides: Partial<Row> = {}): Row =>
  fresh({ status: "CLOSED", closedAt: T0, closeKind: kind, pendingConfirmationAt: kind === "DUTY_MANAGER" ? null : T0 - DAY, firstResponseAt: T0 - DAY, ...overrides });

describe("CL1 the transition table", () => {
  it("CL1 lists exactly the transitions of the brief", () => {
    expect(TRANSITIONS).toEqual({
      NEW: ["ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION"],
      ASSIGNED: ["IN_PROGRESS", "PENDING_CONFIRMATION"],
      IN_PROGRESS: ["PENDING_CONFIRMATION"],
      PENDING_CONFIRMATION: ["CLOSED", "REOPENED"],
      CLOSED: ["REOPENED"],
      REOPENED: ["ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION"],
    });
  });

  it("CL1 START and MARK_RESOLVED follow the table from every status", () => {
    for (const status of STATUSES) {
      const row = status === "CLOSED" ? closed("CONFIRMED") : status === "PENDING_CONFIRMATION" ? pending() : fresh({ status, reopenCount: status === "REOPENED" ? 1 : 0 });
      const start = apply(row, { kind: "START" });
      expect(start.ok, `START from ${status}`).toBe(TRANSITIONS[status].includes("IN_PROGRESS"));
      const resolved = apply(row, { kind: "MARK_RESOLVED" });
      expect(resolved.ok, `MARK_RESOLVED from ${status}`).toBe(TRANSITIONS[status].includes("PENDING_CONFIRMATION"));
    }
  });

  it("CL1 ASSIGN: NEW and REOPENED become ASSIGNED, ASSIGNED and IN_PROGRESS keep their status, the rest are refused", () => {
    expect(fieldsOf(fresh(), { kind: "ASSIGN" }).status).toBe("ASSIGNED");
    expect(fieldsOf(fresh({ status: "REOPENED", reopenCount: 1 }), { kind: "ASSIGN" }).status).toBe("ASSIGNED");
    expect(fieldsOf(fresh({ status: "ASSIGNED" }), { kind: "ASSIGN" }).status).toBe("ASSIGNED");
    expect(fieldsOf(fresh({ status: "IN_PROGRESS" }), { kind: "ASSIGN" }).status).toBe("IN_PROGRESS");
    expect(apply(pending(), { kind: "ASSIGN" })).toEqual({ ok: false, refusal: "INVALID_TRANSITION" });
    expect(apply(closed("CONFIRMED"), { kind: "ASSIGN" })).toEqual({ ok: false, refusal: "INVALID_TRANSITION" });
  });
});

describe("CL1 the rules", () => {
  it("CL1 mark resolved goes to PENDING_CONFIRMATION with its time, and is refused for a safety complaint", () => {
    const fields = fieldsOf(fresh({ status: "IN_PROGRESS" }), { kind: "MARK_RESOLVED" });
    expect(fields).toMatchObject({ status: "PENDING_CONFIRMATION", pendingConfirmationAt: T0, closedAt: null, closeKind: null });
    expect(apply(fresh({ status: "IN_PROGRESS", safetyFlag: true, urgency: "CRITICAL" }), { kind: "MARK_RESOLVED" })).toEqual({ ok: false, refusal: "INVALID_TRANSITION" });
  });

  it("CL1 confirm closes CONFIRMED, with an optional whole rating from 1 to 5", () => {
    expect(fieldsOf(pending(), { kind: "CONFIRM" })).toMatchObject({ status: "CLOSED", closeKind: "CONFIRMED", closedAt: T0, rating: null });
    expect(fieldsOf(pending(), { kind: "CONFIRM", rating: 4 })).toMatchObject({ rating: 4 });
    for (const rating of [0, 6, 2.5, Number.NaN, -1]) expect(apply(pending(), { kind: "CONFIRM", rating }), `rating ${rating}`).toEqual({ ok: false, refusal: "VALIDATION" });
  });

  it("CL1 a repeated confirm, and a confirm from any other status, is refused", () => {
    expect(apply(closed("CONFIRMED"), { kind: "CONFIRM" })).toEqual({ ok: false, refusal: "INVALID_TRANSITION" });
    for (const status of ["NEW", "ASSIGNED", "IN_PROGRESS", "REOPENED"] as const) expect(apply(fresh({ status, reopenCount: status === "REOPENED" ? 1 : 0 }), { kind: "CONFIRM" }).ok).toBe(false);
  });

  it("CL1 reopen needs a reason of 5 to 500 characters, clears the closure fields and counts the reopen", () => {
    expect(isValidReason("abcd")).toBe(false);
    expect(isValidReason("    abcd   ")).toBe(false);
    expect(isValidReason("abcde")).toBe(true);
    expect(isValidReason("x".repeat(500))).toBe(true);
    expect(isValidReason("x".repeat(501))).toBe(false);
    expect(isValidReason(undefined)).toBe(false);
    expect(apply(pending(), { kind: "REOPEN", reason: "no" })).toEqual({ ok: false, refusal: "VALIDATION" });
    const row = closed("CONFIRMED", { rating: 5, reopenCount: 1 });
    expect(fieldsOf(row, { kind: "REOPEN", reason: "Still leaking" }, T0 + DAY)).toMatchObject({
      status: "REOPENED",
      closedAt: null,
      closeKind: null,
      rating: null,
      pendingConfirmationAt: null,
      reopenCount: 2,
    });
    expect(fieldsOf(pending(), { kind: "REOPEN", reason: "Still leaking" })).toMatchObject({ status: "REOPENED", reopenCount: 1 });
  });

  it("CL1 a reopen is allowed up to 7 days after closing and refused after", () => {
    const row = closed("CONFIRMED");
    expect(apply(row, { kind: "REOPEN", reason: "Still leaking" }, T0 + 7 * DAY).ok).toBe(true);
    expect(apply(row, { kind: "REOPEN", reason: "Still leaking" }, T0 + 7 * DAY + 1)).toEqual({ ok: false, refusal: "INVALID_TRANSITION" });
  });

  it("CL1 a safety closure by the duty manager may be disputed by the resident within the window", () => {
    const row = closed("DUTY_MANAGER", { safetyFlag: true, urgency: "CRITICAL" });
    const fields = fieldsOf(row, { kind: "REOPEN", reason: "The smell is back" }, T0 + DAY);
    expect(fields).toMatchObject({ status: "REOPENED", closeKind: null, reopenCount: 1 });
  });

  it("CL1 auto-close needs auto_close_days in PENDING_CONFIRMATION and never applies to a safety complaint", () => {
    const row = pending();
    expect(apply(row, { kind: "AUTO_CLOSE" }, T0 + 7 * DAY - 1)).toEqual({ ok: false, refusal: "INVALID_TRANSITION" });
    expect(fieldsOf(row, { kind: "AUTO_CLOSE" }, T0 + 7 * DAY)).toMatchObject({ status: "CLOSED", closeKind: "AUTO_CLOSED", closedAt: T0 + 7 * DAY, rating: null });
    expect(applyTransition(row, { kind: "AUTO_CLOSE" }, T0 + 3 * DAY, { ...defaultLifecycleSettings, autoCloseDays: 3 }).ok).toBe(true);
    expect(apply(pending({ safetyFlag: true, urgency: "CRITICAL" }), { kind: "AUTO_CLOSE" }, T0 + 30 * DAY).ok).toBe(false);
    expect(apply(fresh({ status: "ASSIGNED" }), { kind: "AUTO_CLOSE" }, T0 + 30 * DAY).ok).toBe(false);
  });

  it("CL1 a safety complaint is closed only by closeSafety, with DUTY_MANAGER; a non-safety one never is", () => {
    const safety = fresh({ status: "ASSIGNED", safetyFlag: true, urgency: "CRITICAL" });
    expect(fieldsOf(safety, { kind: "CLOSE_SAFETY" })).toMatchObject({ status: "CLOSED", closeKind: "DUTY_MANAGER", closedAt: T0 });
    expect(apply(safety, { kind: "CONFIRM" }).ok).toBe(false);
    expect(apply(fresh({ status: "ASSIGNED" }), { kind: "CLOSE_SAFETY" })).toEqual({ ok: false, refusal: "INVALID_TRANSITION" });
    expect(apply(closed("DUTY_MANAGER", { safetyFlag: true, urgency: "CRITICAL" }), { kind: "CLOSE_SAFETY" }).ok).toBe(false);
  });

  it("CL1 first_response_at is set by the first staff action and then never changes", () => {
    const first = fieldsOf(fresh(), { kind: "ASSIGN" }, T0 + 5);
    expect(first.firstResponseAt).toBe(T0 + 5);
    const second = fieldsOf({ ...fresh({ status: "ASSIGNED" }), firstResponseAt: first.firstResponseAt }, { kind: "START" }, T0 + 99);
    expect(second.firstResponseAt).toBe(T0 + 5);
    expect(fieldsOf(fresh(), { kind: "RESPOND" }, T0 + 7)).toMatchObject({ status: "NEW", firstResponseAt: T0 + 7 });
    for (const action of [{ kind: "CONFIRM" }, { kind: "REOPEN", reason: "Still leaking" }] as const) {
      expect(fieldsOf(pending({ firstResponseAt: null }), action).firstResponseAt, action.kind).toBeNull();
    }
    expect(fieldsOf(pending({ firstResponseAt: null }), { kind: "AUTO_CLOSE" }, T0 + 8 * DAY).firstResponseAt).toBeNull();
  });
});

describe("CL1 K1 to K4 hold for every reachable state", () => {
  const PROPERTY_RUNS = 2000;
  const MAX_STEPS = 14;

  function randomAction(r: ReturnType<typeof createPrng>): LifecycleAction {
    const kind = r.pick(["ASSIGN", "START", "MARK_RESOLVED", "RESPOND", "CONFIRM", "REOPEN", "AUTO_CLOSE", "CLOSE_SAFETY"] as const);
    if (kind === "CONFIRM") return r.chance(0.5) ? { kind, rating: r.int(0, 7) } : { kind };
    if (kind === "REOPEN") return { kind, reason: r.pick(["", "abc", "Still leaking", "x".repeat(501), "The smell is back"]) };
    return { kind };
  }

  it(`CL1 ${PROPERTY_RUNS} seeded random action sequences: every reachable state passes K1 to K4 and the safety and rating rules`, () => {
    const rng = createPrng(20261107);
    let applied = 0;
    const reached = new Set<string>();
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const r = rng.fork(`run:${run}`);
      const safetyFlag = r.chance(0.4);
      let row: Row = fresh({ safetyFlag, urgency: safetyFlag ? "CRITICAL" : r.pick(["HIGH", "NORMAL", "LOW"] as const) });
      let now = T0;
      for (let step = 0; step < MAX_STEPS; step++) {
        now += r.pick([1, 1000, 3_600_000, DAY, 3 * DAY, 8 * DAY]);
        const action = randomAction(r);
        const result = applyTransition(row, action, now);
        if (!result.ok) continue;
        applied++;
        row = { ...row, ...result.fields };
        reached.add(`${row.safetyFlag ? "safety" : "plain"}:${row.status}:${row.closeKind ?? "-"}`);
        expect(violations(row), `run ${run} step ${step} ${JSON.stringify(action)} -> ${JSON.stringify(row)}`).toEqual([]);
        if (row.safetyFlag) expect(row.closeKind === "CONFIRMED" || row.closeKind === "AUTO_CLOSED", `run ${run}: a safety complaint was ${row.closeKind}`).toBe(false);
        if (row.status === "CLOSED") expect(row.closedAt !== null && row.closeKind !== null, `run ${run}: CLOSED without closed_at or close_kind`).toBe(true);
        if (row.rating !== null) expect(row.closeKind, `run ${run}: a rating on a ${row.closeKind} close`).toBe("CONFIRMED");
      }
    }
    expect(applied).toBeGreaterThan(PROPERTY_RUNS * 3);
    for (const state of ["plain:CLOSED:CONFIRMED", "plain:CLOSED:AUTO_CLOSED", "safety:CLOSED:DUTY_MANAGER", "plain:REOPENED:-", "safety:REOPENED:-", "plain:PENDING_CONFIRMATION:-", "plain:IN_PROGRESS:-"]) {
      expect(reached.has(state), `the random walks never reached ${state}`).toBe(true);
    }
  });

  it("CL1 the checks themselves detect each violation (a broken row fails)", () => {
    expect(violations(fresh({ safetyFlag: true, urgency: "HIGH" }))).toEqual(["K1"]);
    expect(violations(closed("AUTO_CLOSED", { safetyFlag: true, urgency: "CRITICAL" }))).toContain("K2");
    expect(violations(fresh({ status: "CLOSED" }))).toEqual(["K3"]);
    expect(violations(fresh({ closedAt: T0 }))).toEqual(["K3"]);
    expect(violations(fresh({ status: "PENDING_CONFIRMATION" }))).toEqual(["K3b"]);
    expect(violations(closed("AUTO_CLOSED", { rating: 3 }))).toEqual(["K4"]);
    expect(violations(closed("CONFIRMED", { rating: 6 }))).toEqual(["K4"]);
    expect(violations(fresh({ status: "REOPENED" }))).toEqual(["K4b"]);
  });
});

describe("CL7 the SLA", () => {
  it("CL7 response_due_at is the creation time plus the minutes of the urgency, 15 / 120 / 1,440 / 4,320 by default", () => {
    expect(defaultSlaMinutes).toEqual({ CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 });
    expect(responseDueAt(T0, "CRITICAL")).toBe(T0 + 15 * 60_000);
    expect(responseDueAt(T0, "HIGH")).toBe(T0 + 2 * 3_600_000);
    expect(responseDueAt(T0, "NORMAL")).toBe(T0 + DAY);
    expect(responseDueAt(T0, "LOW")).toBe(T0 + 3 * DAY);
    expect(responseDueAt(T0, "HIGH", { CRITICAL: 1, HIGH: 7, NORMAL: 1, LOW: 1 })).toBe(T0 + 7 * 60_000);
  });

  it("CL7 the SLA state: on time, met, overdue (no response, or resolved after the due time), none once closed", () => {
    const base = { status: "ASSIGNED" as ComplaintStatus, responseDueAt: T0 + 1000, firstResponseAt: null, pendingConfirmationAt: null };
    expect(slaState({ ...base, now: T0 })).toBe("ON_TIME");
    expect(slaState({ ...base, now: T0 + 1001 })).toBe("OVERDUE");
    expect(slaState({ ...base, firstResponseAt: T0 + 10, now: T0 + 5000 })).toBe("MET");
    expect(slaState({ ...base, status: "PENDING_CONFIRMATION", firstResponseAt: T0 + 10, pendingConfirmationAt: T0 + 2000, now: T0 + 5000 })).toBe("OVERDUE");
    expect(slaState({ ...base, status: "CLOSED", now: T0 + 5000 })).toBe("NONE");
    expect(slaState({ ...base, responseDueAt: null, now: T0 })).toBe("NONE");
  });
});
