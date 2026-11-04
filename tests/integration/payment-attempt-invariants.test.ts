import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SQLSTATE,
  connect,
  insertAttempt,
  insertBill,
  insertFlat,
  rejectedWith,
  uniqueRef,
} from "./db";

let db: Client;
let flatId: string;
let billCount = 0;

beforeAll(async () => {
  db = await connect();
  flatId = await insertFlat(db);
});
afterAll(() => db.end());

function newBill() {
  const n = billCount++;
  const year = 2030 + Math.floor(n / 12);
  const month = String((n % 12) + 1).padStart(2, "0");
  return insertBill(db, flatId, `${year}-${month}-01`);
}

describe("I6 at most one unresolved payment attempt per bill", () => {
  it.each(["INITIATED", "PROCESSING"])("I6 rejects a second attempt while the first is %s", async (first) => {
    const billId = await newBill();
    await insertAttempt(db, billId, flatId, { status: first });
    await rejectedWith(
      insertAttempt(db, billId, flatId, { status: "INITIATED" }),
      SQLSTATE.uniqueViolation,
      "payment_attempts_one_unresolved_per_bill",
    );
    await rejectedWith(
      insertAttempt(db, billId, flatId, { status: "PROCESSING" }),
      SQLSTATE.uniqueViolation,
      "payment_attempts_one_unresolved_per_bill",
    );
  });

  it.each(["SUCCEEDED", "FAILED", "RELEASED"])("I6 allows a new attempt once the first is %s", async (resolved) => {
    const billId = await newBill();
    const first = await insertAttempt(db, billId, flatId, { status: "INITIATED" });
    await db.query("UPDATE payment_attempts SET status = $2, release_reason = $3 WHERE id = $1", [
      first,
      resolved,
      resolved === "RELEASED" ? "gateway confirmed no debit" : null,
    ]);
    await expect(insertAttempt(db, billId, flatId, { status: "INITIATED" })).resolves.toBeTypeOf("string");
  });

  it("I6 allows unresolved attempts on different bills", async () => {
    const [billA, billB] = [await newBill(), await newBill()];
    await insertAttempt(db, billA, flatId);
    await expect(insertAttempt(db, billB, flatId)).resolves.toBeTypeOf("string");
  });
});

describe("I7 gateway_reference unique; RELEASED requires release_reason", () => {
  it("I7 rejects a duplicate gateway_reference but allows many NULLs", async () => {
    const gatewayReference = uniqueRef("pay");
    await insertAttempt(db, await newBill(), flatId, { gatewayReference });
    await rejectedWith(
      insertAttempt(db, await newBill(), flatId, { gatewayReference }),
      SQLSTATE.uniqueViolation,
      "payment_attempts_gateway_reference_key",
    );
    await insertAttempt(db, await newBill(), flatId, { gatewayReference: null });
    await expect(insertAttempt(db, await newBill(), flatId, { gatewayReference: null })).resolves.toBeTypeOf("string");
  });

  it.each([null, "", "  "])("I7 rejects RELEASED with release_reason %j", async (releaseReason) => {
    await rejectedWith(
      insertAttempt(db, await newBill(), flatId, { status: "RELEASED", releaseReason }),
      SQLSTATE.checkViolation,
      "payment_attempts_released_has_reason",
    );
  });

  it("I7 accepts RELEASED with a release_reason", async () => {
    await expect(
      insertAttempt(db, await newBill(), flatId, { status: "RELEASED", releaseReason: "customer abandoned" }),
    ).resolves.toBeTypeOf("string");
  });
});
