import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { en } from "@/lib/messages/en";
import { assembleHome, type EntryRow } from "@/server/home/mapper";
import { inputFor } from "../server/home-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const at = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** T21-1601 after a principal-only payment on 27 Oct: PAYMENT ₹5,660 and LATE_FEE ₹38, plus optional later fee payments. */
function feeOnlyHtml(laterPayments: { date: string; amountPaise: bigint }[] = [], now?: number): string {
  const input = inputFor("T21-1601");
  const oct = input.bills.find((b) => b.period.toISOString().startsWith("2026-10"));
  if (oct === undefined) throw new Error("no October bill");
  const entry = (id: string, entryType: "PAYMENT" | "LATE_FEE", direction: "PAYMENT" | "CHARGE", amountPaise: bigint, date: string, n: number): EntryRow => ({
    id,
    entryType,
    direction,
    amountPaise,
    effectiveDate: at(date),
    billId: oct.id,
    reversesEntryId: null,
    createdAt: new Date(1_800_000_000_000 + n),
  });
  const extra = [
    entry("fo-p", "PAYMENT", "PAYMENT", 566_000n, "2026-10-27", 1),
    entry("fo-f", "LATE_FEE", "CHARGE", 3_800n, "2026-10-27", 2),
    ...laterPayments.map((p, i) => entry(`fo-l${i}`, "PAYMENT", "PAYMENT", p.amountPaise, p.date, 3 + i)),
  ];
  const data = assembleHome({ ...input, now: now ?? input.now, entries: [...input.entries, ...extra] });
  if (data.kind !== "OK") throw new Error("expected OK");
  return renderToStaticMarkup(h(HomeView, { data }));
}

describe("FA6 the late fee due variant on the Home (D107)", () => {
  const html = feeOnlyHtml();
  const words = text(html);

  it("shows the tag, the label, the amount and the Pay label of the fee alone", () => {
    expect(words).toContain("Late fee due");
    expect(words).toContain("Amount due, as of 27 Oct");
    expect(words).toContain("₹38");
    expect(words).toContain("Pay ₹38");
    expect(words).not.toContain("days overdue");
    expect(words).not.toContain("Pay oldest bill");
    expect(words).not.toContain("No dues");
  });

  it("the tag is a status tag with words, on the same row as the hero amount", () => {
    expect(html).toMatch(/<span class="tnum text-hero font-semibold">₹38<\/span><span[^>]*>Late fee due/);
  });

  it("the breakdown sheet lists the bill as paid in full, the payments, the fee accrued until the principal was paid, and the total", () => {
    expect(words).toContain("Bill issued, October, paid in full");
    expect(words).toContain("Late fee, accrued until 27 Oct");
    expect(words).toContain("-₹5,660");
    expect(words).toContain("-₹5,000");
    expect(words).not.toContain("Late fee so far");
  });

  it("the working is the one as of the day the principal was paid, in the same words as before", () => {
    expect(words).toContain("How the late fee is worked out");
    expect(words).toContain("₹10,660 × 12% a year × 3 days ÷ 365");
    expect(words).toContain("₹5,660 × 12% a year × 15 days ÷ 365");
    expect(words).toContain("= ₹38.43, rounded to ₹38");
    expect(words).not.toContain("a day until you pay");
  });

  it("two days later the amount, the label's date and the breakdown's date change, the fee and its working do not", () => {
    const later = text(feeOnlyHtml([], Date.UTC(2026, 9, 29, 6, 30)));
    expect(later).toContain("Amount due, as of 29 Oct");
    expect(later).toContain("₹38");
    expect(later).toContain("Late fee, accrued until 27 Oct");
    expect(later).toContain("= ₹38.43, rounded to ₹38");
  });

  it("a part payment of the fee shows as a payments line and the amount due is what remains", () => {
    const part = text(feeOnlyHtml([{ date: "2026-10-27", amountPaise: 1_800n }]));
    expect(part).toContain("Pay ₹20");
    expect(part).toContain("-₹18");
    expect(part).toContain("Late fee due");
  });
});

describe("FA6 strings and styling", () => {
  const html = feeOnlyHtml();

  it("the new strings are in the message catalog", () => {
    expect(en["dues.lateFeeDue"]).toBe("Late fee due");
    expect(en["dues.sheet.billIssuedPaid"]).toBe("Bill issued, {month}, paid in full");
    expect(en["dues.sheet.lateFeeAccrued"]).toBe("Late fee, accrued until {date}");
  });

  it("no source file other than the catalog holds those strings", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk("src");
    const holders = files.filter((f) => /"[^"\n]*(Late fee due|paid in full|accrued until)[^"\n]*"/.test(readFileSync(f, "utf8")));
    expect(holders.map((f) => path.normalize(f))).toEqual([path.normalize("src/lib/messages/en.ts")]);
  });

  it("uses no uppercase, letter-spacing, arbitrary colours or inline styles", () => {
    expect(html).not.toMatch(/\buppercase\b|\btracking-|style="|#[0-9a-fA-F]{3,8}\b/);
  });
});
