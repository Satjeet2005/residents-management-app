import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSED_AT, SQLSTATE, connect, insertComplaint, insertFlat, insertUser, rejectedWith } from "./db";

let db: Client;
let flatId: string;
let userId: string;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
  userId = await insertUser(db);
});
afterAll(() => db.end());

const complaint = (overrides: Record<string, unknown> = {}) => insertComplaint(db, flatId, userId, overrides);
const closed = (overrides: Record<string, unknown> = {}) =>
  complaint({ status: "CLOSED", closed_at: CLOSED_AT, close_kind: "CONFIRMED", ...overrides });
const accepted = (id: Promise<string>) => expect(id).resolves.toBeTypeOf("string");

describe("K1 safety_flag requires urgency CRITICAL", () => {
  it.each(["HIGH", "NORMAL", "LOW"])("K1 rejects safety_flag with urgency %s", async (urgency) => {
    await rejectedWith(
      complaint({ safety_flag: true, urgency }),
      SQLSTATE.checkViolation,
      "complaints_safety_requires_critical",
    );
  });

  it("K1 accepts safety_flag with CRITICAL, and any urgency without safety_flag", async () => {
    await accepted(complaint({ safety_flag: true, urgency: "CRITICAL" }));
    for (const urgency of ["CRITICAL", "HIGH", "NORMAL", "LOW"]) {
      await accepted(complaint({ safety_flag: false, urgency }));
    }
  });

  it("K1 NULL case: a NULL urgency or a NULL safety_flag is rejected (NOT NULL columns)", async () => {
    await rejectedWith(complaint({ urgency: null }), SQLSTATE.notNullViolation);
    await rejectedWith(complaint({ safety_flag: null }), SQLSTATE.notNullViolation);
  });
});

describe("K2 safety complaints never close by themselves", () => {
  it.each(["CONFIRMED", "AUTO_CLOSED"])("K2 rejects a safety complaint closed as %s", async (closeKind) => {
    await rejectedWith(
      closed({ safety_flag: true, urgency: "CRITICAL", close_kind: closeKind }),
      SQLSTATE.checkViolation,
      "complaints_safety_never_auto_closes",
    );
  });

  it("K2 accepts a safety complaint closed by DUTY_MANAGER", async () => {
    await accepted(closed({ safety_flag: true, urgency: "CRITICAL", close_kind: "DUTY_MANAGER" }));
  });

  it("K2 NULL case: an open safety complaint (close_kind NULL) is accepted, and so is a non-safety CONFIRMED close", async () => {
    await accepted(complaint({ safety_flag: true, urgency: "CRITICAL", close_kind: null }));
    await accepted(closed({ safety_flag: false, close_kind: "CONFIRMED" }));
  });
});

describe("K3 status and closure agree", () => {
  it("K3 rejects CLOSED without closed_at, without close_kind, or without both", async () => {
    const constraint = "complaints_closure_matches_status";
    await rejectedWith(complaint({ status: "CLOSED", close_kind: "CONFIRMED" }), SQLSTATE.checkViolation, constraint);
    await rejectedWith(complaint({ status: "CLOSED", closed_at: CLOSED_AT }), SQLSTATE.checkViolation, constraint);
    await rejectedWith(complaint({ status: "CLOSED" }), SQLSTATE.checkViolation, constraint);
  });

  it.each([
    ["NEW", {}],
    ["ASSIGNED", {}],
    ["IN_PROGRESS", {}],
    ["PENDING_CONFIRMATION", { pending_confirmation_at: CLOSED_AT }],
    ["REOPENED", { reopen_count: 1 }],
  ])("K3 rejects %s with closed_at or close_kind set, and accepts it with both NULL", async (status, extra) => {
    const constraint = "complaints_closure_matches_status";
    await rejectedWith(complaint({ status, closed_at: CLOSED_AT, ...extra }), SQLSTATE.checkViolation, constraint);
    await rejectedWith(complaint({ status, close_kind: "CONFIRMED", ...extra }), SQLSTATE.checkViolation, constraint);
    await accepted(complaint({ status, ...extra }));
  });

  it("K3 accepts CLOSED with both closed_at and close_kind", async () => {
    await accepted(closed());
  });

  it("K3 PENDING_CONFIRMATION requires pending_confirmation_at (NULL case rejected)", async () => {
    await rejectedWith(
      complaint({ status: "PENDING_CONFIRMATION", pending_confirmation_at: null }),
      SQLSTATE.checkViolation,
      "complaints_pending_has_timestamp",
    );
    await accepted(complaint({ status: "PENDING_CONFIRMATION", pending_confirmation_at: CLOSED_AT }));
  });

  it("K3 NULL case: a NULL status is rejected (NOT NULL column)", async () => {
    await rejectedWith(complaint({ status: null }), SQLSTATE.notNullViolation);
  });
});

describe("K4 rating, reopen_count", () => {
  it.each([0, 6, -1])("K4 rejects rating %i even on a CLOSED / CONFIRMED complaint", async (rating) => {
    await rejectedWith(closed({ rating }), SQLSTATE.checkViolation, "complaints_rating_in_range");
  });

  it.each([1, 5])("K4 accepts rating %i on a CLOSED / CONFIRMED complaint", async (rating) => {
    await accepted(closed({ rating }));
  });

  it("K4 NULL case: a rating on a complaint whose close_kind is NULL is rejected", async () => {
    await rejectedWith(
      complaint({ status: "NEW", close_kind: null, rating: 3 }),
      SQLSTATE.checkViolation,
      "complaints_rating_only_when_confirmed_close",
    );
  });

  it.each(["AUTO_CLOSED", "DUTY_MANAGER"])("K4 rejects a rating on a complaint closed as %s", async (closeKind) => {
    await rejectedWith(
      closed({ close_kind: closeKind, rating: 4 }),
      SQLSTATE.checkViolation,
      "complaints_rating_only_when_confirmed_close",
    );
  });

  it("K4 rejects a rating on a REOPENED complaint", async () => {
    await rejectedWith(
      complaint({ status: "REOPENED", reopen_count: 1, rating: 4 }),
      SQLSTATE.checkViolation,
      "complaints_rating_only_when_confirmed_close",
    );
  });

  it("K4 NULL case: a NULL rating is always accepted", async () => {
    await accepted(complaint({ rating: null }));
    await accepted(closed({ rating: null }));
  });

  it("K4 rejects a negative reopen_count; a NULL reopen_count is rejected (NOT NULL)", async () => {
    await rejectedWith(complaint({ reopen_count: -1 }), SQLSTATE.checkViolation, "complaints_reopen_count_non_negative");
    await rejectedWith(complaint({ reopen_count: null }), SQLSTATE.notNullViolation);
    await accepted(complaint({ reopen_count: 0 }));
  });

  it("K4 REOPENED requires reopen_count >= 1", async () => {
    await rejectedWith(
      complaint({ status: "REOPENED", reopen_count: 0 }),
      SQLSTATE.checkViolation,
      "complaints_reopened_has_reopen_count",
    );
    await accepted(complaint({ status: "REOPENED", reopen_count: 1 }));
  });
});

describe("K9 complaints.body is not blank", () => {
  it.each(["", "   ", "\t\n"])("K9 rejects a blank body %j", async (body) => {
    await rejectedWith(complaint({ body }), SQLSTATE.checkViolation, "complaints_body_not_blank");
  });

  it("K9 NULL case: a NULL body is rejected (NOT NULL column); a real body is accepted", async () => {
    await rejectedWith(complaint({ body: null }), SQLSTATE.notNullViolation);
    await accepted(complaint({ body: "Lift stuck on the 4th floor" }));
  });
});
