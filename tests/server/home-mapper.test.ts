import { describe, expect, it } from "vitest";
import { computeDues, type DueBill, type DueEntry } from "@/domain/billing/dues";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { complaintStep } from "@/domain/complaints/step";
import { DEMO_NOW } from "@/domain/seed/types";
import { addDays, diffDays } from "@/domain/time/calendar";
import { assembleHome, complaintTitle, computeReplyDue, parsePolicy, type ComplaintRow } from "@/server/home/mapper";
import { replyDueText } from "@/lib/home-text";
import { parseBankAccount, paymentNoticeOf } from "@/server/home/mapper";
import { SETTINGS, dataset, home, inputFor } from "./home-fixtures";

/** An independent computation of one bill's fee: a loop over each overdue day with BigInt, rounded once at the end. */
function independentDue(amount: bigint, dueOn: string, asOf: string, payments: { date: string; amountPaise: bigint }[]): bigint {
  let numerator = 0n;
  for (let d = 1; d <= diffDays(dueOn, asOf); d++) {
    const date = addDays(dueOn, d);
    const paid = payments.filter((p) => p.date < date).reduce((s, p) => s + p.amountPaise, 0n);
    numerator += (amount > paid ? amount - paid : 0n) * 1200n;
  }
  const fee = ((2n * numerator + 3_650_000n * 100n) / (2n * 3_650_000n * 100n)) * 100n;
  const paidTotal = payments.filter((p) => p.date <= asOf).reduce((s, p) => s + p.amountPaise, 0n);
  return (amount > paidTotal ? amount - paidTotal : 0n) + fee;
}

describe("HM1 dues for the sample flats at 27 Oct 2026, 12:00 India time", () => {
  it("T12-0408: ₹6,468 due, OVERDUE, 47 days, one open bill, fee ₹98 and its working", () => {
    const { dues, flat, userName } = home("T12-0408");
    expect(dues.status).toBe("OVERDUE");
    expect(dues.amountDuePaise).toBe(646_800n);
    expect(dues.oldest).toEqual({ dueOn: "2026-09-10", overdueDays: 47, daysUntilDue: 0 });
    expect(dues.openBills).toHaveLength(1);
    expect(dues.openBills[0]).toMatchObject({ outstandingPaise: 637_000n, feePaise: 9_800n, overdueDays: 47, period: "2026-09-01" });
    expect(dues.openBills[0].working?.exactPaise).toBe(9_843n);
    expect(dues.partlyPaid).toBeNull();
    expect(flat).toEqual({ code: "T12-0408", relation: expect.stringMatching(/^(TENANT|OWNER)$/) });
    expect(userName.length).toBeGreaterThan(0);
  });

  it("T21-1601: ₹5,698 due, PARTLY_PAID: ₹5,000 paid on 12 Oct, ₹5,660 still due, plus ₹38", () => {
    const { dues } = home("T21-1601");
    expect(dues.status).toBe("PARTLY_PAID");
    expect(dues.amountDuePaise).toBe(569_800n);
    expect(dues.partlyPaid).toEqual({ paidPaise: 500_000n, lastPaidOn: "2026-10-12", stillDuePaise: 566_000n, feePaise: 3_800n });
    expect(dues.oldest?.overdueDays).toBe(18);
    expect(dues.openBills[0].working?.segments).toHaveLength(2);
  });

  it("T07-1203: no dues, ALL_PAID, the last payment is ₹7,475 on 3 Oct", () => {
    const { dues } = home("T07-1203");
    expect(dues.status).toBe("ALL_PAID");
    expect(dues.amountDuePaise).toBe(0n);
    expect(dues.openBills).toHaveLength(0);
    expect(dues.lastPayment).toEqual({ amountPaise: 747_500n, date: "2026-10-03" });
    expect(dues.balancePaise).toBe(0n);
  });

  it("T15-0902: two open bills (47 and 17 days), the total equals an independent BigInt computation", () => {
    const { dues } = home("T15-0902");
    expect(dues.openBills.map((b) => b.overdueDays)).toEqual([47, 17]);
    const flat = dataset().flats.find((f) => f.code === "T15-0902");
    const bills = dataset().bills.filter((b) => b.flatKey === flat?.key && b.dueOn >= "2026-09-01");
    const expected = bills.map((b) => independentDue(b.amountPaise, b.dueOn, "2026-10-27", [])).reduce((a, b) => a + b, 0n);
    expect(bills).toHaveLength(2);
    expect(dues.amountDuePaise).toBe(expected);
    expect(dues.amountDuePaise).toBe(1_734_100n);
    expect(dues.status).toBe("OVERDUE");
  });

  it.each(["T03-0702", "T18-1105", "T26-0301"])("%s (a look-alike flat): ₹10,720 due, 18 days overdue", (code) => {
    const { dues } = home(code);
    expect(dues.amountDuePaise).toBe(1_072_000n);
    expect(dues.oldest?.overdueDays).toBeGreaterThan(0);
    expect(dues.status).toBe("OVERDUE");
  });

  it("recent activity is the last two ledger entries, newest first (T12-0408: the September bill, then the August payment)", () => {
    const { recent } = home("T12-0408");
    expect(recent).toHaveLength(2);
    expect(recent[0]).toEqual({ entryType: "BILL", date: "2026-09-01", amountPaise: 637_000n });
    expect(recent[1].date <= recent[0].date).toBe(true);
  });
});

describe("HM1 dues variants built by hand", () => {
  const bill = (over: Partial<DueBill> = {}): DueBill => ({ id: "b1", period: "2026-11-01", issuedOn: "2026-11-01", dueOn: "2026-11-10", amountPaise: 637_000n, ...over });
  const entry = (over: Partial<DueEntry>): DueEntry => ({ id: "e1", entryType: "BILL", direction: "CHARGE", amountPaise: 637_000n, effectiveDate: "2026-11-01", billId: "b1", reversesEntryId: null, ...over });
  const run = (bills: DueBill[], entries: DueEntry[], today: string) => computeDues({ bills, entries, policy: defaultLateFeePolicy, today });

  it("NOT_YET_DUE: due 10 Nov, today 27 Oct is 14 days before, no fee", () => {
    const dues = run([bill({ period: "2026-10-01", issuedOn: "2026-10-01" })], [entry({ effectiveDate: "2026-10-01" })], "2026-10-27");
    expect(dues.status).toBe("NOT_YET_DUE");
    expect(dues.amountDuePaise).toBe(637_000n);
    expect(dues.oldest).toEqual({ dueOn: "2026-11-10", overdueDays: 0, daysUntilDue: 14 });
    expect(dues.openBills[0].feePaise).toBe(0n);
    expect(dues.openBills[0].working).toBeNull();
  });

  it("due today is not overdue; the next day it is", () => {
    const b = bill({ dueOn: "2026-10-10", period: "2026-10-01", issuedOn: "2026-10-01" });
    expect(run([b], [entry({})], "2026-10-10").status).toBe("NOT_YET_DUE");
    expect(run([b], [entry({})], "2026-10-11").status).toBe("OVERDUE");
  });

  it("a bill issued after today is not part of the dues", () => {
    const dues = run([bill()], [entry({ effectiveDate: "2026-11-01" })], "2026-10-27");
    expect(dues.openBills).toHaveLength(0);
    expect(dues.status).toBe("ALL_PAID");
  });

  it("CREDIT: payments above the charges give the credit and no dues", () => {
    const dues = run(
      [bill({ dueOn: "2026-09-10", period: "2026-09-01", issuedOn: "2026-09-01" })],
      [entry({ effectiveDate: "2026-09-01" }), entry({ id: "p1", entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 700_000n, effectiveDate: "2026-09-05" })],
      "2026-10-27",
    );
    expect(dues.status).toBe("CREDIT");
    expect(dues.creditPaise).toBe(63_000n);
    expect(dues.amountDuePaise).toBe(0n);
    expect(dues.lastPayment).toEqual({ amountPaise: 700_000n, date: "2026-09-05" });
  });

  it("a payment that was reversed does not count: the bill is open again", () => {
    const dues = run(
      [bill({ dueOn: "2026-09-10", period: "2026-09-01", issuedOn: "2026-09-01" })],
      [
        entry({ effectiveDate: "2026-09-01" }),
        entry({ id: "p1", entryType: "PAYMENT", direction: "PAYMENT", effectiveDate: "2026-09-05" }),
        entry({ id: "r1", entryType: "REVERSAL", direction: "CHARGE", effectiveDate: "2026-09-06", billId: null, reversesEntryId: "p1" }),
      ],
      "2026-10-27",
    );
    expect(dues.status).toBe("OVERDUE");
    expect(dues.amountDuePaise).toBe(646_800n);
    expect(dues.balancePaise).toBe(637_000n);
    expect(dues.lastPayment).toBeNull();
  });

  it("a payment dated after today is ignored", () => {
    const dues = run([bill({ dueOn: "2026-09-10", period: "2026-09-01", issuedOn: "2026-09-01" })], [entry({ effectiveDate: "2026-09-01" }), entry({ id: "p1", entryType: "PAYMENT", direction: "PAYMENT", effectiveDate: "2026-12-01" })], "2026-10-27");
    expect(dues.amountDuePaise).toBe(646_800n);
  });

  it("no ledger entries at all is ALL_PAID with no last payment", () => {
    const dues = run([], [], "2026-10-27");
    expect(dues).toMatchObject({ status: "ALL_PAID", amountDuePaise: 0n, creditPaise: 0n, lastPayment: null, balancePaise: 0n });
  });
});

describe("FA1 Home data for a flat whose principal is paid and whose late fee is not (D107)", () => {
  it("T21-1601 after a principal-only payment is LATE_FEE_DUE, ₹38, FEE_ONLY, with the fee as of the day the principal was paid", () => {
    const input = inputFor("T21-1601");
    const oct = input.bills.find((b) => b.period.toISOString().startsWith("2026-10"));
    if (oct === undefined) throw new Error("no October bill");
    const day = new Date("2026-10-27T00:00:00.000Z");
    const entry = (id: string, entryType: "PAYMENT" | "LATE_FEE", direction: "PAYMENT" | "CHARGE", amountPaise: bigint, n: number) => ({ id, entryType, direction, amountPaise, effectiveDate: day, billId: oct.id, reversesEntryId: null, createdAt: new Date(1_800_000_000_000 + n) });
    const data = assembleHome({ ...input, entries: [...input.entries, entry("fa-p", "PAYMENT", "PAYMENT", 566_000n, 1), entry("fa-f", "LATE_FEE", "CHARGE", 3_800n, 2)] });
    if (data.kind !== "OK") throw new Error("expected OK");
    expect(data.dues).toMatchObject({ status: "LATE_FEE_DUE", amountDuePaise: 3_800n, partlyPaid: null });
    expect(data.dues.openBills).toHaveLength(1);
    expect(data.dues.openBills[0]).toMatchObject({ kind: "FEE_ONLY", feePaise: 3_800n, outstandingPaise: 0n, settledOn: "2026-10-27" });
  });
});

describe("HM1 the other parts of the Home data", () => {
  it("no current membership is NO_FLAT", () => {
    expect(assembleHome({ ...inputFor("T12-0408"), memberships: [] })).toEqual({ kind: "NO_FLAT", userName: expect.any(String), asOf: "2026-10-27" });
  });

  it("several flats: the first by code is shown and the note flag is set", () => {
    const base = inputFor("T12-0408");
    const data = assembleHome({ ...base, memberships: [{ flatId: "z", flatCode: "T21-1601", relation: "OWNER" }, ...base.memberships] });
    expect(data.kind === "OK" && data.flat.code).toBe("T12-0408");
    expect(data.kind === "OK" && data.moreThanOneFlat).toBe(true);
    expect(home("T12-0408").moreThanOneFlat).toBe(false);
  });

  it("two memberships in the same flat are one flat", () => {
    const base = inputFor("T12-0408");
    const data = assembleHome({ ...base, memberships: [...base.memberships, { ...base.memberships[0], relation: "FAMILY" }] });
    expect(data.kind === "OK" && data.moreThanOneFlat).toBe(false);
  });

  it("T12-0408: the open complaint is ASSIGNED, step 2, and reply due today", () => {
    const data = home("T12-0408");
    expect(data.complaint).toMatchObject({ title: "Water leak under the kitchen sink", status: "ASSIGNED", current: 1, needsAnswer: false });
    expect(data.complaint?.reply).toMatchObject({ kind: "DUE", today: true });
    expect(replyDueText(data.complaint?.reply as never)).toBe("Reply due today, 5 pm");
    expect(data.otherOpenComplaints).toBe(0);
    expect(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/Ramesh|Anita/);
  });

  it("T07-1203: PENDING_CONFIRMATION is step 4 and needs an answer; it already had a reply", () => {
    const data = home("T07-1203");
    expect(data.complaint).toMatchObject({ status: "PENDING_CONFIRMATION", current: 3, needsAnswer: true, reply: null });
  });

  it("T15-0902: a NEW complaint is step 1 and its reply is due tomorrow", () => {
    const data = home("T15-0902");
    expect(data.complaint).toMatchObject({ status: "NEW", current: 0 });
    expect(replyDueText(data.complaint?.reply as never)).toBe("Reply due 28 Oct, 10 am");
  });

  it("T21-1601 has no complaint", () => {
    expect(home("T21-1601").complaint).toBeNull();
  });

  it("the shown complaint is the newest open one; a closed complaint is not counted; the others are counted", () => {
    const base = inputFor("T12-0408");
    const extra = (body: string, minutes: number, status: ComplaintRow["status"]): ComplaintRow => ({ id: `extra-${body}`, safetyFlag: false, body, status, createdAt: new Date(DEMO_NOW + minutes * 60_000), responseDueAt: null, firstResponseAt: null, acknowledgedAt: null });
    const data = assembleHome({ ...base, complaints: [...base.complaints, extra("Newest one\nsecond line", 5, "NEW"), extra("Closed one", 10, "CLOSED"), extra("Older", -9999, "IN_PROGRESS")] });
    expect(data.kind === "OK" && data.complaint?.title).toBe("Newest one");
    expect(data.kind === "OK" && data.otherOpenComplaints).toBe(2);
  });

  it("the emergency numbers come from the settings; a null emergency number stays null", () => {
    expect(home("T12-0408").emergency).toEqual({ dutyManagerPhone: "5900000001", emergencyServicesPhone: null });
    const set = SETTINGS.map((s) => (s.key === "emergency_services_phone" ? { key: s.key, value: "112" } : s));
    const data = assembleHome({ ...inputFor("T12-0408"), settings: set });
    expect(data.kind === "OK" && data.emergency.emergencyServicesPhone).toBe("112");
  });

  it("a flat with no ledger entry has no activity, no dues and no recent lines", () => {
    const data = assembleHome({ ...inputFor("T12-0408"), bills: [], entries: [] });
    expect(data.kind === "OK" && data.hasActivity).toBe(false);
    expect(data.kind === "OK" && data.recent).toEqual([]);
    expect(data.kind === "OK" && data.dues.status).toBe("ALL_PAID");
  });

  it("the data survives structuredClone: it is plain (no functions, no Date objects, no rows)", () => {
    const data = home("T21-1601");
    expect(structuredClone(data)).toEqual(data);
    expect(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("[object");
  });

  it("the asOf date is the India date of now: 19:00 UTC on 26 Oct is already 27 Oct", () => {
    expect(home("T12-0408", Date.UTC(2026, 9, 26, 19, 0)).asOf).toBe("2026-10-27");
  });
});

describe("HM1 parsePolicy: a wrong setting is an error, never a guess", () => {
  it("reads the seeded policy", () => {
    expect(parsePolicy(SETTINGS)).toEqual(defaultLateFeePolicy);
  });
  it.each([
    [[]],
    [[{ key: "late_fee_policy", value: null }]],
    [[{ key: "late_fee_policy", value: { annualRateBps: 1200 } }]],
    [[{ key: "late_fee_policy", value: { annualRateBps: 2500, capBps: 2100, daysInYear: 365 } }]],
    [[{ key: "late_fee_policy", value: { annualRateBps: 12.5, capBps: 2100, daysInYear: 365 } }]],
    [[{ key: "late_fee_policy", value: { annualRateBps: 1200, capBps: 2100, daysInYear: 0 } }]],
  ])("throws for %j", (settings) => {
    expect(() => parsePolicy(settings)).toThrow();
  });
});

describe("HM3 complaintStep", () => {
  it.each([
    ["NEW", 0, false],
    ["ASSIGNED", 1, false],
    ["IN_PROGRESS", 2, false],
    ["PENDING_CONFIRMATION", 3, true],
    ["REOPENED", 1, false],
    ["CLOSED", 3, false],
  ] as const)("%s is step index %i, needsAnswer %s", (status, current, needsAnswer) => {
    const step = complaintStep(status);
    expect(step.current).toBe(current);
    expect(step.needsAnswer).toBe(needsAnswer);
    expect(step.steps).toEqual(["complaint.step.raised", "complaint.step.assigned", "complaint.step.inProgress", "complaint.step.resolved"]);
  });
});

describe("HM3 reply due, in India time", () => {
  const NOW = Date.UTC(2026, 9, 27, 6, 30); // 27 Oct 12:00 IST

  it("due later today: 'Reply due today, 5 pm'", () => {
    const due = Date.UTC(2026, 9, 27, 11, 30); // 17:00 IST
    const reply = computeReplyDue({ responseDueAt: due, firstResponseAt: null, now: NOW });
    expect(reply).toEqual({ kind: "DUE", dueAt: due, today: true });
    expect(replyDueText(reply as never)).toBe("Reply due today, 5 pm");
  });

  it("due tomorrow morning: 'Reply due 28 Oct, 9 am'", () => {
    const reply = computeReplyDue({ responseDueAt: Date.UTC(2026, 9, 28, 3, 30), firstResponseAt: null, now: NOW });
    expect(reply).toMatchObject({ kind: "DUE", today: false });
    expect(replyDueText(reply as never)).toBe("Reply due 28 Oct, 9 am");
  });

  it("the date is the India date: 19:00 UTC on the 27th is 00:30 on the 28th", () => {
    const reply = computeReplyDue({ responseDueAt: Date.UTC(2026, 9, 27, 19, 0), firstResponseAt: null, now: NOW });
    expect(replyDueText(reply as never)).toBe("Reply due 28 Oct, 12:30 am");
  });

  it("past its time with no reply: 'Reply overdue'; at the very moment it is still due", () => {
    const due = Date.UTC(2026, 9, 27, 4, 30);
    expect(replyDueText(computeReplyDue({ responseDueAt: due, firstResponseAt: null, now: NOW }) as never)).toBe("Reply overdue");
    expect(computeReplyDue({ responseDueAt: NOW, firstResponseAt: null, now: NOW })).toMatchObject({ kind: "DUE" });
  });

  it("nothing once someone has replied, or when no time is set", () => {
    expect(computeReplyDue({ responseDueAt: NOW - 1000, firstResponseAt: NOW - 5000, now: NOW })).toBeNull();
    expect(computeReplyDue({ responseDueAt: null, firstResponseAt: null, now: NOW })).toBeNull();
  });
});

describe("HM3 complaintTitle", () => {
  it.each([
    ["Water leak under the kitchen sink", "Water leak under the kitchen sink"],
    ["First line\nSecond line", "First line"],
    ["\n\n  Padded  \nnext", "Padded"],
    ["", ""],
    ["a".repeat(60), "a".repeat(60)],
    ["a".repeat(61), `${"a".repeat(59)}…`],
    ["ख".repeat(70), `${"ख".repeat(59)}…`],
  ])("%j -> %j", (body, title) => {
    expect(complaintTitle(body)).toBe(title);
    expect(Array.from(complaintTitle(body)).length).toBeLessThanOrEqual(60);
  });
});

describe("PY8 the payment notice and the bank account in the Home data", () => {
  const NOW = DEMO_NOW;
  const attempt = (status: "INITIATED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "RELEASED", ago: number) => ({ status, startedAt: new Date(NOW - ago) });
  it.each<[string, ReturnType<typeof attempt> | null, "LAST_FAILED" | null]>([
    ["no attempt", null, null],
    ["FAILED an hour ago", attempt("FAILED", 3_600_000), "LAST_FAILED"],
    ["FAILED exactly 24 hours ago", attempt("FAILED", 86_400_000), "LAST_FAILED"],
    ["FAILED 24 hours and a millisecond ago", attempt("FAILED", 86_400_001), null],
    ["FAILED a week ago", attempt("FAILED", 7 * 86_400_000), null],
    ["INITIATED a minute ago", attempt("INITIATED", 60_000), null],
    ["SUCCEEDED a minute ago", attempt("SUCCEEDED", 60_000), null],
    ["PROCESSING a minute ago", attempt("PROCESSING", 60_000), null],
    ["RELEASED a minute ago", attempt("RELEASED", 60_000), null],
    ["FAILED, started 'in the future' (the date is frozen for a demo)", attempt("FAILED", -5_000), "LAST_FAILED"],
  ])("%s", (_label, latest, expected) => {
    expect(paymentNoticeOf(latest, NOW)).toBe(expected);
  });

  it("the Home data carries the notice and the account of the settings", () => {
    const data = home("T12-0408");
    expect(data.paymentNotice).toBeNull();
    expect(data.bankAccount).toEqual({ name: "Sample Society Maintenance Account", number: "000000000000", ifsc: "SAMP0000000" });
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["not an object", "000000000000"],
    ["no ifsc", { name: "A", number: "1" }],
    ["an empty name", { name: "", number: "1", ifsc: "X" }],
    ["a number instead of text", { name: "A", number: 1, ifsc: "X" }],
  ])("a bank account setting that is %s is null, never a half-filled panel", (_label, value) => {
    expect(parseBankAccount(value === undefined ? [] : [{ key: "society_bank_account", value }])).toBeNull();
  });
});
