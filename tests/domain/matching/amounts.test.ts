import { describe, expect, it } from "vitest";
import { computeLateFee, defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { amountIndexFor, amountRelation, lateFeeOn, oldestDue } from "@/domain/matching/amounts";
import { buildMatchContext } from "@/domain/matching/context";
import { bill, flat } from "./builders";

const policy = defaultLateFeePolicy;
const SEPT = bill("sep", 637000n, "2026-09-10");
const OCT = bill("oct", 637000n, "2026-10-10");

describe("lateFeeOn", () => {
  it("is computeLateFee with no holds", () => {
    const direct = computeLateFee({ billAmountPaise: 637000n, dueOn: "2026-09-10", asOf: "2026-10-27", payments: [], holds: [], policy });
    expect(lateFeeOn(SEPT, "2026-10-27", policy)).toEqual(direct);
    expect(direct.feePaise).toBe(9800n);
  });

  it("ignores a payment dated after the date asked about", () => {
    const paidLater = bill("sep", 637000n, "2026-09-10", [{ date: "2026-10-20", amountPaise: 300000n }]);
    expect(lateFeeOn(paidLater, "2026-10-15", policy)).toEqual(lateFeeOn(SEPT, "2026-10-15", policy));
  });

  it("shares a cache entry between bills with the same amount, due date and payments", () => {
    const cache = new Map();
    const first = lateFeeOn(SEPT, "2026-10-27", policy, cache);
    const second = lateFeeOn(bill("other", 637000n, "2026-09-10"), "2026-10-27", policy, cache);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
    lateFeeOn(SEPT, "2026-10-28", policy, cache);
    expect(cache.size).toBe(2);
  });
});

describe("oldestDue", () => {
  it("is principal plus fee for the oldest bill", () => {
    expect(oldestDue([SEPT, OCT], "2026-10-27", policy)).toEqual({ billKey: "sep", billAmountPaise: 637000n, outstandingPaise: 637000n, feePaise: 9800n, duePaise: 646800n });
  });

  it("uses the unpaid part after a part payment, and the fee on that part", () => {
    const part = bill("oct", 1066000n, "2026-10-09", [{ date: "2026-10-12", amountPaise: 500000n }]);
    expect(oldestDue([part], "2026-10-27", policy)).toMatchObject({ outstandingPaise: 566000n, feePaise: 3800n, duePaise: 569800n });
  });

  it("skips a bill that payments dated by the date already cover", () => {
    const covered = bill("sep", 637000n, "2026-09-10", [{ date: "2026-10-01", amountPaise: 637000n }]);
    expect(oldestDue([covered, OCT], "2026-10-27", policy)?.billKey).toBe("oct");
    expect(oldestDue([covered], "2026-10-27", policy)).toBeNull();
  });

  it("is null with no bills, and has no fee before the due date", () => {
    expect(oldestDue([], "2026-10-27", policy)).toBeNull();
    expect(oldestDue([OCT], "2026-10-05", policy)).toMatchObject({ feePaise: 0n, duePaise: 637000n });
  });
});

describe("amountRelation", () => {
  const bills = [SEPT, OCT];
  const due = oldestDue(bills, "2026-10-27", policy);
  it.each([
    [646800n, "EQUALS_DUE"],
    [637000n, "EQUALS_PRINCIPAL"],
    [100000n, "LESS_THAN_DUE"],
    [650000n, "MORE_THAN_DUE"],
    [1274000n, "MORE_THAN_DUE"],
  ] as const)("%s is %s", (credit, expected) => {
    expect(amountRelation(credit, bills, due)).toBe(expected);
  });

  it("is EQUALS_BILL when the credit is a later bill's full amount and not the oldest bill's due", () => {
    const part = bill("sep", 637000n, "2026-09-10", [{ date: "2026-09-20", amountPaise: 400000n }]);
    const later = bill("oct", 500000n, "2026-10-10");
    expect(amountRelation(500000n, [part, later], oldestDue([part, later], "2026-10-27", policy))).toBe("EQUALS_BILL");
  });

  it("is EQUALS_DUE, not EQUALS_PRINCIPAL, when there is no fee", () => {
    expect(amountRelation(637000n, [OCT], oldestDue([OCT], "2026-10-05", policy))).toBe("EQUALS_DUE");
  });

  it("is NO_OPEN_BILL with no bill", () => {
    expect(amountRelation(100n, [], null)).toBe("NO_OPEN_BILL");
  });
});

describe("amountIndexFor", () => {
  const context = buildMatchContext([
    flat("T01-0101", { bills: [SEPT] }),
    flat("T02-0101", { bills: [bill("x", 637000n, "2026-09-10")] }),
    flat("T03-0101", { bills: [bill("y", 100000n, "2026-09-10")] }),
    flat("T04-0101"),
  ]);

  it("lists flats by the amount due and by the principal of their oldest open bill", () => {
    const index = amountIndexFor(context, "2026-10-27");
    expect(index.byDue.get(646800n)).toEqual(["T01-0101", "T02-0101"]);
    expect(index.byPrincipal.get(637000n)).toEqual(["T01-0101", "T02-0101"]);
    expect(index.byDue.get(637000n)).toBeUndefined();
  });

  it("is built once per date and differs between dates", () => {
    const first = amountIndexFor(context, "2026-10-27");
    expect(amountIndexFor(context, "2026-10-27")).toBe(first);
    expect(context.caches.amounts.size).toBe(1);
    expect(amountIndexFor(context, "2026-09-05").byDue.get(637000n)).toEqual(["T01-0101", "T02-0101"]);
    expect(context.caches.amounts.size).toBe(2);
  });
});
