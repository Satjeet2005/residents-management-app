import { describe, expect, it } from "vitest";
import { interpretPayResponse, payErrorText, payLabel } from "@/lib/pay";

describe("PY8 interpretPayResponse: what the Pay control does with each answer of POST /api/payments", () => {
  it.each<[string, number, unknown, ReturnType<typeof interpretPayResponse>]>([
    ["200 with a checkout path goes there", 200, { attemptId: "a", checkoutPath: "/pay/mock/a", amountPaise: "646800" }, { type: "GO", checkoutPath: "/pay/mock/a" }],
    ["409 AMOUNT_CHANGED carries the new amount as a bigint", 409, { error: "AMOUNT_CHANGED", amountPaise: "647000" }, { type: "CHANGED", amountPaise: 647_000n }],
    ["409 NO_DUES is an error with nothing to pay", 409, { error: "NO_DUES" }, { type: "ERROR", kind: "NO_DUES" }],
    ["503 is not available", 503, { error: "PAYMENT_PROVIDER_NOT_CONFIGURED" }, { type: "ERROR", kind: "UNAVAILABLE" }],
    ["500 is a server error", 500, { error: "SERVER_ERROR" }, { type: "ERROR", kind: "SERVER" }],
    ["401 is a server error (no detail is shown)", 401, { error: "UNAUTHENTICATED" }, { type: "ERROR", kind: "SERVER" }],
    ["400 is a server error", 400, { error: "INVALID_REQUEST" }, { type: "ERROR", kind: "SERVER" }],
    ["200 with no body is a server error", 200, null, { type: "ERROR", kind: "SERVER" }],
    ["409 AMOUNT_CHANGED with a bad amount is a server error", 409, { error: "AMOUNT_CHANGED", amountPaise: "12.5" }, { type: "ERROR", kind: "SERVER" }],
    ["409 AMOUNT_CHANGED with a number instead of a string is a server error", 409, { error: "AMOUNT_CHANGED", amountPaise: 647000 }, { type: "ERROR", kind: "SERVER" }],
  ])("%s", (_label, status, body, expected) => {
    expect(interpretPayResponse(status, body)).toEqual(expected);
  });

  it.each(["//evil.example/x", "https://evil.example/x", "javascript:alert(1)", "/\\evil.example", "pay/mock/a", "", 5, null])("never follows a checkout path like %j", (checkoutPath) => {
    expect(interpretPayResponse(200, { checkoutPath })).toEqual({ type: "ERROR", kind: "SERVER" });
  });
});

describe("PY8 the Pay label (D99)", () => {
  it("is 'Pay ₹X' with one open bill and 'Pay oldest bill ₹X' with more than one", () => {
    expect(payLabel(646_800n, 1)).toBe("Pay ₹6,468");
    expect(payLabel(646_800n, 2)).toBe("Pay oldest bill ₹6,468");
    expect(payLabel(646_800n, 3)).toBe("Pay oldest bill ₹6,468");
    expect(payLabel(12_345_600n, 1)).toBe("Pay ₹1,23,456");
  });

  it("every error kind has its own plain sentence", () => {
    const texts = (["UNAVAILABLE", "NETWORK", "SERVER", "NO_DUES"] as const).map(payErrorText);
    expect(new Set(texts).size).toBe(4);
    for (const text of texts) expect(text).toMatch(/\.$/);
  });
});
