import { describe, expect, it } from "vitest";
import { parseNarration, type ParsedNarration, type Rail } from "@/domain/matching/narration";

type Expected = {
  rail: Rail;
  ref?: string;
  vpa?: string;
  name?: string;
  flats?: string[];
  hints?: ("maintenance" | "rent" | "advance")[];
  months?: number;
};

const summary = (p: ParsedNarration) => ({
  rail: p.rail,
  ref: p.reference,
  vpa: p.vpa,
  name: p.remitterName,
  flats: p.flatTokens.map((t) => t.code),
  hints: (Object.keys(p.hints) as (keyof ParsedNarration["hints"])[]).filter((k) => p.hints[k]),
  months: p.months,
});

const expand = (e: Expected) => ({ rail: e.rail, ref: e.ref ?? null, vpa: e.vpa ?? null, name: e.name ?? null, flats: e.flats ?? [], hints: e.hints ?? [], months: e.months ?? null });

/** Synthetic narrations: the formats are assumptions, not any bank's specification (docs/bank-statements.md). */
const CASES: [string, Expected][] = [
  // UPI
  ["UPI/402200118877/aamir.s@oksbi/maintenance", { rail: "UPI", ref: "402200118877", vpa: "aamir.s@oksbi", hints: ["maintenance"] }],
  ["UPI-402200118877-AAMIR SHAIKH-aamir.s@oksbi-T21 1601", { rail: "UPI", ref: "402200118877", vpa: "aamir.s@oksbi", name: "AAMIR SHAIKH", flats: ["T21-1601"] }],
  ["UPI 402200118877 T07-1203 maint", { rail: "UPI", ref: "402200118877", flats: ["T07-1203"], hints: ["maintenance"] }],
  ["UPI/402200223344/priya.n@ybl/rent", { rail: "UPI", ref: "402200223344", vpa: "priya.n@ybl", hints: ["rent"] }],
  ["upi/402200118877/aamir.s@oksbi/MAINTENANCE", { rail: "UPI", ref: "402200118877", vpa: "aamir.s@oksbi", hints: ["maintenance"] }],
  ["UPI/402200118877/RAHUL SHARMA/rahul.s@okaxis/T12 408/maint", { rail: "UPI", ref: "402200118877", vpa: "rahul.s@okaxis", name: "RAHUL SHARMA", flats: ["T12-0408"], hints: ["maintenance"] }],
  ["UPI-402200118877-T12-0408", { rail: "UPI", ref: "402200118877", flats: ["T12-0408"] }],
  ["UPI/DR/402200118877/Ramesh Gupta/ramesh@paytm/T07-1203", { rail: "UPI", ref: "402200118877", vpa: "ramesh@paytm", name: "RAMESH GUPTA", flats: ["T07-1203"] }],
  ["UPI/P2A/402200118877/ANITA DESAI/HDFC BANK/T05 1102", { rail: "UPI", ref: "402200118877", name: "ANITA DESAI", flats: ["T05-1102"] }],
  ["UPI/402200118877/T21-1601 advance/aamir.s@oksbi", { rail: "UPI", ref: "402200118877", vpa: "aamir.s@oksbi", flats: ["T21-1601"], hints: ["advance"] }],
  ["UPI / 402200118877 / AAMIR S / T21 1601", { rail: "UPI", ref: "402200118877", name: "AAMIR S", flats: ["T21-1601"] }],
  ["UPI-402200118877-MR AAMIR SHAIKH-T21-1601 3 MTHS", { rail: "UPI", ref: "402200118877", name: "MR AAMIR SHAIKH", flats: ["T21-1601"], months: 3 }],
  ["UPI/4022001188/xy@ybl", { rail: "UPI", vpa: "xy@ybl" }],
  ["UPI/4022001188779/xy@ybl", { rail: "UPI", vpa: "xy@ybl" }],
  ["UPI/402200118877/402200118878", { rail: "UPI", ref: "402200118877" }],
  ["UPI/402200118877/S N DESHPANDE/sn.d@okicici/T01 0101 6 months advance", { rail: "UPI", ref: "402200118877", vpa: "sn.d@okicici", name: "S N DESHPANDE", flats: ["T01-0101"], hints: ["advance"], months: 6 }],
  ["UPI-402200118877-O'BRIEN K-ok@ybl-T11 0305", { rail: "UPI", ref: "402200118877", vpa: "ok@ybl", name: "OBRIEN K", flats: ["T11-0305"] }],
  ["UPI/402200118877//aamir.s@oksbi//", { rail: "UPI", ref: "402200118877", vpa: "aamir.s@oksbi" }],
  ["UPI 402200118877 AAMIR SHAIKH T21 1601", { rail: "UPI", ref: "402200118877", name: "AAMIR SHAIKH", flats: ["T21-1601"] }],
  ["UPI/402200118877/AAMIR SHAIKH\tT21 1601\n", { rail: "UPI", ref: "402200118877", name: "AAMIR SHAIKH", flats: ["T21-1601"] }],
  ["UPI/402200118877/t12_408/Maint.", { rail: "UPI", ref: "402200118877", flats: ["T12-0408"], hints: ["maintenance"] }],
  ["UPI/402200118877/T12 408 and T07 1203", { rail: "UPI", ref: "402200118877", flats: ["T12-0408", "T07-1203"] }],
  ["UPI/402200118877/t12-0408/maint 24 months", { rail: "UPI", ref: "402200118877", flats: ["T12-0408"], hints: ["maintenance"], months: 24 }],
  ["UPI/402200118877/maint 25 months", { rail: "UPI", ref: "402200118877", hints: ["maintenance"] }],
  ["UPI/402200118877/T1 1101", { rail: "UPI", ref: "402200118877", flats: ["T01-1101", "T11-0101"] }],
  // NEFT
  ["NEFT-N30112345-SHARMA R-T12 408", { rail: "NEFT", ref: "N30112345", name: "SHARMA R", flats: ["T12-0408"] }],
  ["NEFT/N30112346/GUPTA AND SONS/T15-0902 3 months", { rail: "NEFT", ref: "N30112346", name: "GUPTA AND SONS", flats: ["T15-0902"], months: 3 }],
  ["NEFT/N301123470/PATIL V/T26 0301/maint", { rail: "NEFT", ref: "N301123470", name: "PATIL V", flats: ["T26-0301"], hints: ["maintenance"] }],
  ["NEFT-HDFCN52026102712345-RAHUL KULKARNI-T03 0702", { rail: "NEFT", ref: "HDFCN52026102712345", name: "RAHUL KULKARNI", flats: ["T03-0702"] }],
  ["NEFT*N30112349*SHARMA R*T12-0408", { rail: "NEFT", ref: "N30112349", name: "SHARMA R", flats: ["T12-0408"] }],
  ["NEFT CR N30112350 SMT MEERA JOSHI T18/1105", { rail: "NEFT", ref: "N30112350", name: "SMT MEERA JOSHI", flats: ["T18-1105"] }],
  ["neft-n30112351-sharma r-t12 408", { rail: "NEFT", ref: "N30112351", name: "SHARMA R", flats: ["T12-0408"] }],
  ["NEFT-N30112352", { rail: "NEFT", ref: "N30112352" }],
  ["NEFT-123456789012-GUPTA", { rail: "NEFT", name: "GUPTA" }],
  ["NEFT/N30112353/DR A KULKARNI/T09 1507 maintenance 12 months", { rail: "NEFT", ref: "N30112353", name: "DR A KULKARNI", flats: ["T09-1507"], hints: ["maintenance"], months: 12 }],
  // IMPS
  ["IMPS/5088123456/RAHUL KULKAR/maint T03 702", { rail: "IMPS", ref: "5088123456", name: "RAHUL KULKAR", flats: ["T03-0702"], hints: ["maintenance"] }],
  ["IMPS-508812345678-AMIT PAWAR-T14 0605", { rail: "IMPS", ref: "508812345678", name: "AMIT PAWAR", flats: ["T14-0605"] }],
  ["IMPS 5088123456 T21 1601", { rail: "IMPS", ref: "5088123456", flats: ["T21-1601"] }],
  ["IMPS/P2A/5088123457/NEHA/rent", { rail: "IMPS", ref: "5088123457", name: "NEHA", hints: ["rent"] }],
  ["IMPS/12345/NEHA", { rail: "IMPS", name: "NEHA" }],
  // RTGS
  ["RTGS-HDFCR52026102712345-A SHAIKH-T21-1601 ADV", { rail: "RTGS", ref: "HDFCR52026102712345", name: "A SHAIKH", flats: ["T21-1601"], hints: ["advance"] }],
  ["RTGS/SBIN52026102700011/GUPTA AND SONS/T15 0902 advance", { rail: "RTGS", ref: "SBIN52026102700011", name: "GUPTA AND SONS", flats: ["T15-0902"], hints: ["advance"] }],
  ["RTGS HDFCR52026102712346 T07 1203", { rail: "RTGS", ref: "HDFCR52026102712346", flats: ["T07-1203"] }],
  ["RTGS 402200118877 T12 408", { rail: "RTGS", flats: ["T12-0408"] }],
  // cheques
  ["CHQ DEP 004512", { rail: "CHEQUE_DEPOSIT", ref: "004512" }],
  ["CHEQUE DEPOSIT 004513 T18 1105", { rail: "CHEQUE_DEPOSIT", ref: "004513", flats: ["T18-1105"] }],
  ["CHQ DEP 004514 T03 702", { rail: "CHEQUE_DEPOSIT", ref: "004514", flats: ["T03-0702"] }],
  ["CHQ DEPOSIT-004515-T12-0408", { rail: "CHEQUE_DEPOSIT", ref: "004515", flats: ["T12-0408"] }],
  ["CLG CHQ 004516 T26/0301", { rail: "CHEQUE_DEPOSIT", ref: "004516", flats: ["T26-0301"] }],
  ["CHQ DEP 45", { rail: "CHEQUE_DEPOSIT" }],
  ["CHQ DEP 402200118877", { rail: "CHEQUE_DEPOSIT" }],
  ["CHQ RET 004512 INSUFFICIENT FUNDS", { rail: "CHEQUE_RETURN", ref: "004512" }],
  ["CHQ RETURN 004513 T18 1105", { rail: "CHEQUE_RETURN", ref: "004513", flats: ["T18-1105"] }],
  ["RETURN CHQ 004514 ACCOUNT CLOSED", { rail: "CHEQUE_RETURN", ref: "004514" }],
  ["CHEQUE BOUNCE 004515", { rail: "CHEQUE_RETURN", ref: "004515" }],
  // cash
  ["CASH DEP T12-0408", { rail: "CASH_DEPOSIT", flats: ["T12-0408"] }],
  ["CASH DEPOSIT BY SELF T07 1203", { rail: "CASH_DEPOSIT", flats: ["T07-1203"] }],
  ["CDM CASH DEP 0412 T21-1601 advance", { rail: "CASH_DEPOSIT", flats: ["T21-1601"], hints: ["advance"] }],
  // interest and charges
  ["INT.PD 01-07-2026 TO 30-09-2026", { rail: "INTEREST" }],
  ["INTEREST CREDIT", { rail: "INTEREST" }],
  ["INT PD", { rail: "INTEREST" }],
  ["SMS CHARGES", { rail: "BANK_CHARGE" }],
  ["ATM CHARGES", { rail: "BANK_CHARGE" }],
  ["GST ON SMS CHARGES", { rail: "BANK_CHARGE" }],
  ["NEFT CHARGES", { rail: "BANK_CHARGE" }],
  // text no rail claims
  ["", { rail: "UNKNOWN" }],
  ["   ", { rail: "UNKNOWN" }],
  ["HELLO WORLD", { rail: "UNKNOWN" }],
  ["REF 402200118877 T12 408", { rail: "UNKNOWN", flats: ["T12-0408"] }],
  ["402200118877", { rail: "UNKNOWN" }],
  ["😀😀😀", { rail: "UNKNOWN" }],
  ["TRANSFER FROM MR GUPTA", { rail: "UNKNOWN" }],
  ["T12-0408 maintenance 3 months", { rail: "UNKNOWN", flats: ["T12-0408"], hints: ["maintenance"], months: 3 }],
  ["सोसायटी देखभाल T12 408", { rail: "UNKNOWN", flats: ["T12-0408"] }],
];

describe("P3 narration: table of synthetic families", () => {
  it("has at least 60 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });

  it.each(CASES.map(([raw, expected]) => [raw, expected] as const))("reads %j", (raw, expected) => {
    expect(summary(parseNarration(raw))).toEqual(expand(expected));
  });
});

describe("P3 narration: rules", () => {
  it("a 12-digit run is a UPI reference only on the UPI rail", () => {
    for (const raw of ["402200118877", "REF 402200118877 T12 408", "NEFT-402200118877-GUPTA", "RTGS 402200118877", "CHQ DEP 402200118877", "CASH DEP 402200118877", "SMS CHARGES 402200118877"]) {
      expect(parseNarration(raw).reference, raw).toBeNull();
    }
    expect(parseNarration("UPI/402200118877/x").reference).toBe("402200118877");
  });

  it("returns an ambiguous flat token as ambiguous", () => {
    expect(parseNarration("UPI/402200118877/T1 1101").flatTokens.map((t) => t.ambiguous)).toEqual([true, true]);
    expect(parseNarration("UPI/402200118877/T12 408").flatTokens.map((t) => t.ambiguous)).toEqual([false]);
  });

  it("does not take a flat code out of a UPI address", () => {
    expect(parseNarration("UPI/402200118877/t21.1601@ybl").flatTokens).toEqual([]);
    expect(parseNarration("UPI/402200118877/t21.1601@ybl").vpa).toBe("t21.1601@ybl");
  });

  it("does not read the digits of a flat code as a reference or a month count", () => {
    expect(parseNarration("CHQ DEP T12 408").reference).toBeNull();
    expect(parseNarration("NEFT T15-0902 N30112346").reference).toBe("N30112346");
    expect(parseNarration("T12-0408 6 months").months).toBe(6);
  });

  it("keeps the notes as the words that are left", () => {
    expect(parseNarration("UPI/402200118877/AAMIR SHAIKH/aamir.s@oksbi/T21 1601/maintenance 3 months").notes).toBe("MAINTENANCE 3 MONTHS");
    expect(parseNarration("CHQ RET 004512 INSUFFICIENT FUNDS").notes).toBe("INSUFFICIENT FUNDS");
    expect(parseNarration("HELLO WORLD").notes).toBe("");
  });

  it("reads only the first 1,000 characters", () => {
    const far = `${"x ".repeat(600)}T12-0408`;
    expect(parseNarration(far).flatTokens).toEqual([]);
    expect(parseNarration(`UPI/402200118877/T12-0408${" ".repeat(2000)}T07-1203`).flatTokens.map((t) => t.code)).toEqual(["T12-0408"]);
  });

  it("an unknown text gives no reference, name, notes, address or flat", () => {
    expect(parseNarration("completely unrelated words")).toEqual({
      rail: "UNKNOWN", reference: null, vpa: null, remitterName: null, flatTokens: [], hints: { maintenance: false, rent: false, advance: false }, months: null, notes: "",
    });
  });
});
