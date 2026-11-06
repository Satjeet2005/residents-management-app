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
    const emergency = /<button[^>]*>(?:(?!<\/button>).)*Emergency<\/button>/.exec(html)?.[0] ?? "";
    expect(emergency).toContain("border-control");
    expect(emergency).not.toContain("bg-accent");
  });

  it("the dues show the amount, the overdue tag in words, the date it is worked out for, and the link to the breakdown", () => {
    expect(words).toContain("₹6,468");
    expect(words).toContain("47 days overdue");
    expect(words).toContain("Amount due, as of 27 Oct");
    expect(words).toContain("See what makes up this amount");
  });

  it("the dues are not a bordered card: the label, then the hero amount with the tag on its row, then the double rule, then the link", () => {
    const section = /<section aria-label="Your dues"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0].split("<dialog")[0] ?? "";
    expect(section).not.toContain("border-hairline");
    expect(section).not.toMatch(/\sp-4\b/);
    const order = ["Amount due, as of 27 Oct", "text-hero", "47 days overdue", "h-[7px] border-y-2 border-ink", "See what makes up this amount"].map((needle) => section.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(section).toMatch(/justify-between[^"]*"[^>]*><span class="tnum text-hero font-semibold">₹6,468<\/span><span[^>]*>47 days overdue/);
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

  it("the complaint: title at the left and the status at the right on one row, the tracker, then one line with the step and the reply", () => {
    expect(words).toContain("Your complaints");
    expect(words).toContain("Water leak under the kitchen sink");
    for (const label of ["Raised", "Assigned", "In progress", "Resolved"]) expect(words).toContain(label);
    expect(html).toContain('aria-current="step"');
    expect(words).toContain("Step 2 of 4. Reply due today, 5 pm");
    expect(count(html, /Step 2 of 4/g)).toBe(1);
    const row = /<div class="flex items-start justify-between[^"]*"><p[^>]*>Water leak under the kitchen sink<\/p><span[^>]*><span aria-hidden="true"[^>]*><\/span>Assigned<\/span><\/div>/.exec(html);
    expect(row).not.toBeNull();
    expect(html.indexOf("Water leak under the kitchen sink")).toBeLessThan(html.indexOf("Step 2 of 4"));
    expect(html.indexOf("aria-label=\"Complaint progress\"")).toBeLessThan(html.indexOf("Step 2 of 4"));
  });

  it("the complaints section has a hairline under its header", () => {
    expect(html).toMatch(/Your complaints<\/h2><\/div><hr class="m-0 border-0 border-t border-hairline"\/>/);
  });

  it("visitors: one bold summary line and one line with the times only, between hairlines, and no name", () => {
    const section = /<section aria-label="Visitors">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(section).toMatch(/^<section aria-label="Visitors"><hr[^>]*\/>/);
    expect(section).toMatch(/<hr[^>]*\/><\/section>$/);
    expect(section).toContain('<p class="text-body font-semibold">2 visitors expected today</p>');
    expect(text(section)).toContain("11:00 am and 4:30 pm");
    expect(html).not.toMatch(/Ramesh|Anita/);
  });

  it("recent activity: hairline-ruled rows, date at the left, particulars, the amount in semibold, and no links under it", () => {
    expect(words).toContain("Recent activity");
    expect(words).toContain("1 Sep");
    expect(words).toContain("Bill issued");
    const list = /<ul class="border-t border-hairline">[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(count(list, /<li class="grid grid-cols-\[4\.5rem_1fr_auto\][^"]*border-b border-hairline/g)).toBe(2);
    expect(list).toContain('<span class="tnum text-body font-semibold">₹6,370</span>');
    expect(html).not.toMatch(/View ledger|Receipt/);
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
  it("shows ₹5,698, 18 days overdue and the part-payment line under the double rule", () => {
    const html = render(home("T21-1601"));
    expect(html.indexOf("h-[7px]")).toBeLessThan(html.indexOf("₹5,000 paid on 12 Oct"));
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
    expect(html.indexOf("h-[7px]")).toBeGreaterThan(html.indexOf("No dues"));
    expect(html.indexOf("h-[7px]")).toBeLessThan(html.indexOf("Last payment"));
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
    expect(words).toContain("It will be used for your next bill. Ask accounts if you'd like a refund.");
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

  it("three visitors read as a list of times", () => {
    const at = (h: number) => new Date(DEMO_NOW + h * 3_600_000);
    expect(text(render(assembleHome({ ...inputFor("T12-0408"), visitors: [{ expectedAt: at(-2) }, { expectedAt: at(1) }, { expectedAt: at(3) }] })))).toContain("3 visitors expected today 10:00 am, 1:00 pm and 3:00 pm");
  });

  it("a complaint that has had its first reply shows only the step", () => {
    const base = inputFor("T12-0408");
    const data = assembleHome({ ...base, complaints: base.complaints.map((c) => ({ ...c, firstResponseAt: new Date(DEMO_NOW - 3_600_000) })) });
    const words = text(render(data));
    expect(words).toContain("Step 2 of 4");
    expect(words).not.toContain("Step 2 of 4. Reply");
  });

  it("one visitor reads in the singular, and none reads 'No visitors expected today'", () => {
    const one = text(render(assembleHome({ ...inputFor("T12-0408"), visitors: [{ expectedAt: new Date(DEMO_NOW + 3_600_000) }] })));
    expect(one).toContain("1 visitor expected today");
    expect(one).toContain("1:00 pm");
    const none = text(render(home("T07-1203")));
    expect(none).toContain("No visitors expected today");
    expect(none).not.toMatch(/ am| pm/);
  });

  it("a day overdue is singular", () => {
    const data = assembleHome({ ...base, now: Date.UTC(2026, 10, 10, 6, 30), bills: [...base.bills, { id: "nb", period: day("2026-10-01"), issuedOn: day("2026-10-01"), dueOn: day("2026-11-09"), amountPaise: 637_000n }], entries: [...base.entries, entry({ effectiveDate: day("2026-10-01") })] });
    expect(text(render(data))).toContain("1 day overdue");
  });
});
