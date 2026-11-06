import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { DEMO_NOW } from "@/domain/seed/types";
import { assembleHome, type EntryRow } from "@/server/home/mapper";
import type { HomeData } from "@/server/home/types";
import { home, inputFor } from "../server/home-fixtures";

const render = (data: HomeData) => renderToStaticMarkup(h(HomeView, { data }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

describe("HM5 Home: T12-0408, overdue (₹6,468, 47 days)", () => {
  const html = render(home("T12-0408"));
  const words = text(html);

  it("has one h1 (the flat code), a main landmark, the name with the relation, and an outlined Emergency control", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toContain("<main");
    expect(html).toMatch(/<h1[^>]*>T12-0408<\/h1>/);
    expect(words).toMatch(/Swati Joshi, (Tenant|Owner)|Anil Joshi, (Tenant|Owner)/);
    const emergency = /<button[^>]*>Emergency<\/button>/.exec(html)?.[0] ?? "";
    expect(emergency).toContain("border-control");
    expect(emergency).not.toContain("bg-accent");
  });

  it("the dues card shows the amount, the overdue tag in words, the date it is worked out for, and the link to the breakdown", () => {
    expect(words).toContain("Your dues");
    expect(words).toContain("₹6,468");
    expect(words).toContain("47 days overdue");
    expect(words).toContain("As of 27 Oct");
    expect(words).toContain("See what makes up this amount");
  });

  it("the amount is a hero amount in tabular numerals", () => {
    expect(html).toMatch(/<span class="tnum text-hero font-semibold">₹6,468<\/span>/);
  });

  it("the breakdown sheet is read-only: bill, due date, late fee, the working with exact decimals, the total under a double rule", () => {
    expect(words).toContain("Amount as of 27 Oct 2026");
    expect(words).toContain("Bill issued, September");
    expect(words).toContain("Due 10 Sep");
    expect(words).toContain("Late fee so far, 47 days");
    expect(words).toContain("How the late fee is worked out");
    expect(words).toContain("₹6,370 × 12% a year × 47 days ÷ 365");
    expect(words).toContain("= ₹98.43, rounded to ₹98");
    expect(words).toContain("It grows by about ₹2 a day until you pay.");
    expect(words).toMatch(/Amount due\s*₹6,468/);
    expect(html).toContain("h-[7px] border-y-2 border-ink");
    expect(html).toContain("Your dues");
  });

  it("the complaint card: title, four-step tracker at step 2, reply due today", () => {
    expect(words).toContain("Your complaints");
    expect(words).toContain("Water leak under the kitchen sink");
    expect(words).toContain("Step 2 of 4");
    for (const label of ["Raised", "Assigned", "In progress", "Resolved"]) expect(words).toContain(label);
    expect(html).toContain('aria-current="step"');
    expect(words).toContain("Reply due today, 5 pm");
  });

  it("visitors: two expected today, with their times", () => {
    expect(words).toContain("2 visitors expected today");
    expect(words).toContain("Ramesh Gupta, 11 am");
    expect(words).toContain("Anita Singh, 4:30 pm");
  });

  it("recent activity: two plain ledger lines", () => {
    expect(words).toContain("Recent activity");
    expect(words).toContain("Bill issued");
    expect(count(html, /grid-cols-\[4\.5rem_1fr_auto\]/g)).toBeGreaterThanOrEqual(2);
  });

  it("builds nothing that is not built: no Pay, no View ledger, no Receipt, no complaint buttons", () => {
    expect(html).not.toMatch(/\bPay\b/);
    expect(html).not.toMatch(/View ledger|Receipt|Confirm|Reopen/);
    expect(html).not.toMatch(/<button[^>]*>Raise a complaint/);
    expect(html).not.toMatch(/<a [^>]*href="\/(bills|complaints|ledger)/);
  });

  it("at most one filled control on the page (the only filled one is the call link inside the Emergency sheet)", () => {
    expect(count(html, /bg-accent text-white/g)).toBeLessThanOrEqual(1);
  });

  it("uses no all-capital words and no uppercase styling", () => {
    expect(words).not.toMatch(/\b[A-Z]{4,}\b/);
    expect(html).not.toMatch(/\buppercase\b|tracking-/);
  });

  it("has the Emergency sheet and the breakdown sheet as closed dialogs, each titled", () => {
    expect(count(html, /<dialog/g)).toBe(2);
    expect(html).toContain("Emergency help");
    expect(html).not.toMatch(/<dialog[^>]*\sopen(?=[\s>=])/);
  });
});

describe("HM5 Home: T21-1601, part paid", () => {
  const words = text(render(home("T21-1601")));
  it("shows ₹5,698, 18 days overdue and the part-payment line", () => {
    expect(words).toContain("₹5,698");
    expect(words).toContain("18 days overdue");
    expect(words).toContain("₹5,000 paid on 12 Oct. ₹5,660 still due, plus ₹38 late fee.");
  });
  it("the breakdown lists the payment as a minus line and works the fee in two stretches", () => {
    expect(words).toContain("Payment received");
    expect(words).toContain("-₹5,000");
    expect(words).toContain("₹10,660 × 12% a year × 3 days ÷ 365");
    expect(words).toContain("₹5,660 × 12% a year × 15 days ÷ 365");
    expect(words).toContain("= ₹38.43, rounded to ₹38");
  });
  it("no complaints: says so", () => {
    expect(words).toContain("No open complaints.");
  });
});

describe("HM5 Home: T07-1203, nothing to pay", () => {
  const html = render(home("T07-1203"));
  const words = text(html);
  it("says No dues with the last payment, and has no breakdown link or sheet", () => {
    expect(words).toContain("No dues");
    expect(words).toContain("Last payment ₹7,475 on 3 Oct");
    expect(words).not.toContain("See what makes up this amount");
    expect(words).not.toContain("Amount as of 27 Oct 2026");
    expect(count(html, /<dialog/g)).toBe(1);
  });
  it("shows the complaint that waits for the resident's answer at step 4 of 4", () => {
    expect(words).toContain("Corridor light not working");
    expect(words).toContain("Step 4 of 4");
  });
});

describe("HM5 Home: T15-0902, two open bills", () => {
  const words = text(render(home("T15-0902")));
  it("shows the total of both bills, the oldest overdue days, and a working for each bill with no daily sentence", () => {
    expect(words).toContain("₹17,341");
    expect(words).toContain("47 days overdue");
    expect(words).toContain("September bill");
    expect(words).toContain("October bill");
    expect(words).not.toContain("a day until you pay");
  });
  it("a NEW complaint is step 1 and its reply is due tomorrow", () => {
    expect(words).toContain("Step 1 of 4");
    expect(words).toContain("Reply due 28 Oct, 10 am");
  });
});

describe("HM5 Home: variants built by hand", () => {
  const base = inputFor("T07-1203");
  const entry = (over: Partial<EntryRow>): EntryRow => ({ id: "x", entryType: "BILL", direction: "CHARGE", amountPaise: 637_000n, effectiveDate: day("2026-10-27"), billId: "nb", reversesEntryId: null, createdAt: new Date(2e12), ...over });

  it("NOT_YET_DUE: 'Due 10 Nov, in 14 days', no overdue tag, no fee in the breakdown", () => {
    const data = assembleHome({ ...base, bills: [...base.bills, { id: "nb", period: day("2026-10-27"), issuedOn: day("2026-10-27"), dueOn: day("2026-11-10"), amountPaise: 637_000n }], entries: [...base.entries, entry({})] });
    const words = text(render(data));
    expect(words).toContain("₹6,370");
    expect(words).toContain("Due 10 Nov, in 14 days");
    expect(words).not.toContain("overdue");
    expect(words).not.toContain("Late fee so far");
    expect(words).not.toContain("How the late fee is worked out");
  });

  it("CREDIT: 'No dues. Credit ₹630'", () => {
    const data = assembleHome({ ...base, entries: [...base.entries, entry({ id: "p", entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 63_000n, effectiveDate: day("2026-10-20"), billId: null })] });
    const words = text(render(data));
    expect(words).toContain("No dues. Credit ₹630");
    expect(words).not.toContain("See what makes up this amount");
  });

  it("first run: no ledger entry at all says No dues and No activity yet", () => {
    const words = text(render(assembleHome({ ...base, bills: [], entries: [] })));
    expect(words).toContain("No dues");
    expect(words).toContain("No activity yet");
    expect(words).not.toContain("Last payment");
  });

  it("NO_FLAT: a welcome, one h1, and the empty state", () => {
    const html = render(assembleHome({ ...base, memberships: [] }));
    expect(count(html, /<h1/g)).toBe(1);
    expect(text(html)).toContain("No flat is linked to your account yet. Ask the society office to link your flat.");
    expect(html).not.toContain("Your dues");
  });

  it("several flats: the first is shown with a small note", () => {
    const data = assembleHome({ ...base, memberships: [{ flatId: "z", flatCode: "T99-0001", relation: "OWNER" }, ...base.memberships] });
    const words = text(render(data));
    expect(words).toContain("Showing T07-1203");
  });

  it("one visitor reads in the singular, and none reads 'No visitors expected today'", () => {
    const one = text(render(assembleHome({ ...inputFor("T12-0408"), visitors: [{ visitorName: "Ramesh Gupta", expectedAt: new Date(DEMO_NOW + 3_600_000) }] })));
    expect(one).toContain("1 visitor expected today");
    expect(text(render(home("T07-1203")))).toContain("No visitors expected today");
  });

  it("a day overdue is singular", () => {
    const data = assembleHome({ ...base, now: Date.UTC(2026, 10, 10, 6, 30), bills: [...base.bills, { id: "nb", period: day("2026-10-01"), issuedOn: day("2026-10-01"), dueOn: day("2026-11-09"), amountPaise: 637_000n }], entries: [...base.entries, entry({ effectiveDate: day("2026-10-01") })] });
    expect(text(render(data))).toContain("1 day overdue");
  });
});
