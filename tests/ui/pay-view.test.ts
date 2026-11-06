import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { PayControl, PayFooter } from "@/app/(resident)/pay-control";
import { BankTransferPanel } from "@/app/(resident)/bank-transfer-panel";
import type { PayState } from "@/lib/pay";
import { assembleHome } from "@/server/home/mapper";
import { DEMO_NOW } from "@/domain/seed/types";
import { home, inputFor } from "../server/home-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const html = renderToStaticMarkup;
const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const count = (markup: string, pattern: RegExp) => (markup.match(pattern) ?? []).length;
const render = (flat: string) => html(h(HomeView, { data: home(flat) }));
const outside = (markup: string) => markup.replace(/<dialog[\s\S]*?<\/dialog>/g, "");
const dialogs = (markup: string) => [...markup.matchAll(/<dialog[\s\S]*?<\/dialog>/g)].map((m) => m[0]);

describe("PY8 the Home Pay button (D99)", () => {
  it("one open bill: 'Pay ₹6,468', a full-width 56px primary button after the double rule and before the link", () => {
    const page = outside(render("T12-0408"));
    const button = /<button[^>]*class="[^"]*"[^>]*>Pay ₹6,468<\/button>/.exec(page)?.[0] ?? "";
    expect(button).toContain("min-h-14");
    expect(button).toContain("w-full");
    expect(button).toContain("bg-accent");
    expect(button).toContain('type="button"');
    const order = ["h-[7px]", "Pay ₹6,468", "See what makes up this amount"].map((needle) => page.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("part paid (T21-1601): 'Pay ₹5,698', and the explanatory line sits between the rule and the button", () => {
    const page = outside(render("T21-1601"));
    expect(page).toContain("Pay ₹5,698</button>");
    expect(page.indexOf("₹5,000 paid on 12 Oct")).toBeGreaterThan(page.indexOf("h-[7px]"));
    expect(page.indexOf("₹5,000 paid on 12 Oct")).toBeLessThan(page.indexOf("Pay ₹5,698"));
  });

  it("two open bills (T15-0902): 'Pay oldest bill ₹8,713' (the oldest bill, not the ₹17,341 total)", () => {
    const data = home("T15-0902");
    const [oldest] = data.dues.openBills;
    expect(data.dues.openBills).toHaveLength(2);
    const page = outside(html(h(HomeView, { data })));
    expect(page).toContain("Pay oldest bill ₹8,713</button>");
    expect(oldest.outstandingPaise + oldest.feePaise).toBe(871_300n);
    expect(page).not.toContain("Pay ₹17,341");
    expect(page).not.toContain("Pay oldest bill ₹17,341");
  });

  it("a bill not yet due still has a Pay button", () => {
    const base = inputFor("T07-1203");
    const data = assembleHome({
      ...base,
      bills: [...base.bills, { id: "nb", period: new Date("2026-10-01T00:00:00Z"), issuedOn: new Date("2026-10-27T00:00:00Z"), dueOn: new Date("2026-11-10T00:00:00Z"), amountPaise: 637_000n }],
      entries: [...base.entries, { id: "x", entryType: "BILL", direction: "CHARGE", amountPaise: 637_000n, effectiveDate: new Date("2026-10-27T00:00:00Z"), billId: "nb", reversesEntryId: null, createdAt: new Date(2e12) }],
    });
    expect(text(html(h(HomeView, { data })))).toContain("Pay ₹6,370");
  });

  it("no dues, credit and no activity: no Pay control at all, and no review sheet", () => {
    const paid = render("T07-1203");
    expect(paid).not.toMatch(/>Pay[ <]/);
    expect(paid).not.toContain("The amount is fixed");
    expect(paid).not.toContain("Paying by bank transfer");
    expect(text(html(h(HomeView, { data: assembleHome({ ...inputFor("T07-1203"), bills: [], entries: [] }) })))).not.toMatch(/\bPay\b/);
  });
});

describe("PY8 the review sheet (D34): fixed footer, working, bank transfer", () => {
  const sheet = dialogs(render("T12-0408")).find((d) => d.includes("Amount as of")) ?? "";
  const words = text(sheet);

  it("shows the title, the date, the lines, the total under a double rule, then the working, then the bank transfer panel, in that order", () => {
    expect(words).toContain("Your dues");
    expect(words).toContain("Amount as of 27 Oct 2026");
    const order = ["Amount as of", "Bill issued, September", "Late fee so far, 47 days", "Amount due", "How the late fee is worked out", "Paying by bank transfer instead?"].map((needle) => words.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(sheet).toContain("h-[7px] border-y-2 border-ink");
  });

  it("the bank panel has the payment note chip (the flat code), a Copy payment note button, the instruction, and the payee as given by the setting", () => {
    expect(sheet).toMatch(/<span class="tnum inline-flex min-h-12[^"]*bg-paper-2[^"]*">T12-0408<\/span>/);
    expect(sheet).toMatch(/<button[^>]*min-h-12[^>]*>Copy payment note<\/button>/);
    expect(words).toContain("Put this in the payment note. It shows here once the society has matched it.");
    expect(words).toContain("Account name Sample Society Maintenance Account");
    expect(words).toContain("Account number 000000000000");
    expect(words).toContain("IFSC SAMP0000000");
    expect(sheet).toContain('role="status"');
    expect(words).not.toContain("Copied");
  });

  it("has a sticky footer with the fixed-amount sentence and the Pay button, and no oldest-bill line for a single bill", () => {
    expect(sheet).toMatch(/<div class="sticky bottom-0[^"]*">[\s\S]*The amount is fixed once you tap Pay\.[\s\S]*Pay ₹6,468<\/button>/);
    expect(words).not.toContain("Your oldest bill. Other bills stay due.");
  });

  it("with two open bills the footer says 'Your oldest bill. Other bills stay due.' and the button names the oldest bill", () => {
    const two = dialogs(render("T15-0902")).find((d) => d.includes("Amount as of")) ?? "";
    expect(text(two)).toContain("Your oldest bill. Other bills stay due.");
    expect(two).toContain("Pay oldest bill ₹8,713</button>");
  });

  it("leaves out the payee lines when the society setting is missing, but keeps the note and the button", () => {
    const panel = html(h(BankTransferPanel, { flatCode: "T12-0408", account: null }));
    expect(panel).toContain("Copy payment note");
    expect(panel).not.toContain("Account name");
  });

  it("the copy confirmation area exists from the start (a live region), so 'Copied' is announced when it appears", () => {
    expect(html(h(BankTransferPanel, { flatCode: "T12-0408", account: null }))).toMatch(/<p role="status"[^>]*><\/p>/);
  });
});

describe("PY8 the Pay control in every state", () => {
  const control = (state: PayState, openBills = 1) => html(h(PayControl, { amountPaise: 646_800n, openBills, state, onPay: () => {} }));
  const footer = (state: PayState, openBills = 1) => html(h(PayFooter, { amountPaise: 646_800n, openBills, state, onPay: () => {} }));

  it("idle: the label, enabled", () => {
    const out = control({ phase: "idle" });
    expect(out).toContain("Pay ₹6,468</button>");
    expect(out).not.toContain("disabled");
    expect(out).not.toContain("aria-busy");
  });

  it("loading: a word replaces the label, the button is disabled and marked busy (taps do nothing)", () => {
    const out = control({ phase: "loading" });
    expect(out).toContain(">Starting payment</button>");
    expect(out).toContain("disabled");
    expect(out).toContain('aria-busy="true"');
    expect(out).not.toContain("Pay ₹6,468");
  });

  it("amount changed: the footer says the new amount and to tap again, and the button carries the new amount", () => {
    const out = html(h(PayFooter, { amountPaise: 647_000n, openBills: 1, state: { phase: "changed", amountPaise: 647_000n }, onPay: () => {} }));
    expect(text(out)).toContain("The amount changed to ₹6,470. Tap Pay again.");
    expect(out).toContain('role="status"');
    expect(out).toContain("Pay ₹6,470</button>");
  });

  it.each<[Extract<PayState, { phase: "error" }>["kind"], string]>([
    ["UNAVAILABLE", "Payments are not available right now. Try again later."],
    ["NETWORK", "We could not reach the server. Check your connection and try again."],
    ["SERVER", "Something went wrong on our side. Try again in a moment."],
    ["NO_DUES", "There is nothing to pay right now."],
  ])("error %s: an alert with the message and a Try again button of at least 48px, in place of the Pay button", (kind, message) => {
    const out = control({ phase: "error", kind });
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain(message);
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Try again<\/button>/);
    expect(out).not.toContain("Pay ₹6,468");
  });

  it("the footer always carries the fixed-amount sentence, in every state", () => {
    for (const state of [{ phase: "idle" }, { phase: "loading" }, { phase: "error", kind: "SERVER" }] as PayState[]) expect(text(footer(state))).toContain("The amount is fixed once you tap Pay.");
  });

  it("follows the styling rules: no shadow, no uppercase, no fixed height, token classes only", () => {
    const all = [control({ phase: "idle" }), control({ phase: "loading" }), footer({ phase: "error", kind: "NETWORK" }), render("T12-0408")].join("");
    expect(all).not.toMatch(/shadow|uppercase|tracking-|[\s"]h-(12|14|16)[\s"]/);
  });
});

describe("PY8 the failure strip (D49)", () => {
  const withAttempt = (status: "INITIATED" | "FAILED" | "SUCCEEDED" | "PROCESSING" | "RELEASED", startedAt: number) =>
    text(html(h(HomeView, { data: assembleHome({ ...inputFor("T12-0408"), latestAttempt: { status, startedAt: new Date(startedAt) } }) })));
  const STRIP = "That payment didn't go through. No money left your account.";

  it("shows when the latest attempt FAILED within the last 24 hours, above the dues, with the dues and Pay still available", () => {
    const page = html(h(HomeView, { data: assembleHome({ ...inputFor("T12-0408"), latestAttempt: { status: "FAILED", startedAt: new Date(DEMO_NOW - 3_600_000) } }) }));
    const words = text(page);
    expect(words).toContain(STRIP);
    expect(words).toContain("₹6,468");
    expect(outside(page)).toContain("Pay ₹6,468</button>");
    expect(page).toContain('role="status"');
    expect(page.indexOf("didn&#x27;t go through")).toBeLessThan(page.indexOf("Amount due, as of"));
  });

  it("shows right up to 24 hours and not after", () => {
    expect(withAttempt("FAILED", DEMO_NOW - 24 * 3_600_000)).toContain(STRIP);
    expect(withAttempt("FAILED", DEMO_NOW - 24 * 3_600_000 - 1)).not.toContain(STRIP);
  });

  it.each(["INITIATED", "SUCCEEDED", "PROCESSING", "RELEASED"] as const)("does not show when the latest attempt is %s (a later attempt supersedes the failure)", (status) => {
    expect(withAttempt(status, DEMO_NOW - 60_000)).not.toContain(STRIP);
  });

  it("does not show when there is no attempt, and never at the same time as the no-dues state", () => {
    expect(text(render("T12-0408"))).not.toContain(STRIP);
    expect(text(html(h(HomeView, { data: assembleHome({ ...inputFor("T07-1203"), latestAttempt: null }) })))).not.toContain(STRIP);
  });

  it("the Home has no Pay button inside the strip and counts the Pay controls: one on the page, one in the sheet footer", () => {
    const page = html(h(HomeView, { data: assembleHome({ ...inputFor("T12-0408"), latestAttempt: { status: "FAILED", startedAt: new Date(DEMO_NOW - 1000) } }) }));
    expect(count(page, />Pay ₹6,468<\/button>/g)).toBe(2);
  });
});
