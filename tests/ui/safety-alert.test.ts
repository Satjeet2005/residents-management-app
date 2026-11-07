import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { SafetyAlert } from "@/app/(resident)/safety-alert";
import { DEMO_NOW } from "@/domain/seed/types";
import { assembleHome, type ComplaintRow, type SettingsRow } from "@/server/home/mapper";
import type { HomeData, HomeSafetyAlert } from "@/server/home/types";
import { inputFor } from "../server/home-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const MIN = 60_000;
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const alertHtml = (alert: HomeSafetyAlert) => renderToStaticMarkup(h(SafetyAlert, { alert }));
const safety = (over: Partial<ComplaintRow> = {}): ComplaintRow => ({ id: "s1", safetyFlag: true, body: "There is a fire in the basement", status: "ASSIGNED", createdAt: new Date(DEMO_NOW - MIN), responseDueAt: null, firstResponseAt: null, acknowledgedAt: null, ...over });
const homeWith = (complaint: ComplaintRow | null, now = DEMO_NOW, settings?: SettingsRow[]): Extract<HomeData, { kind: "OK" }> => {
  const base = inputFor("T12-0408", now);
  const data = assembleHome({ ...base, complaints: complaint === null ? base.complaints : [...base.complaints, complaint], settings: settings ?? base.settings });
  if (data.kind !== "OK") throw new Error("expected OK");
  return data;
};
const render = (data: HomeData) => renderToStaticMarkup(h(HomeView, { data }));
/** The page without its two closed sheets (Emergency, Dues): they are modal surfaces of their own, with their own call and Pay buttons. */
const pageOnly = (html: string) => html.replace(/<dialog[\s\S]*?<\/dialog>/g, "");

describe("D126 alert 1a: sent", () => {
  const html = alertHtml({ state: "SENT", category: "FIRE", seenAt: null, callPhone: "5900000001" });

  it("says the report went to the duty manager, in words with the category, and 'If anyone is in danger, call now.'", () => {
    expect(text(html)).toContain("Your fire report has gone to the duty manager");
    expect(text(html)).toContain("If anyone is in danger, call now.");
  });

  it("has a filled 'Call duty manager' tel: link, 56px tall, and nothing else filled", () => {
    expect(html).toMatch(/<a [^>]*bg-accent[^>]*href="tel:5900000001"[^>]*>(<svg[\s\S]*?<\/svg>)?Call duty manager<\/a>/);
    expect(html).toContain("min-h-14");
    expect(count(html, /bg-accent/g)).toBe(1);
  });

  it("is an alert region with heavy rules above and below, a warning icon, and no forbidden styling", () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain("border-y-2 border-ink");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/uppercase|tracking-|italic|shadow/);
  });

  it.each([
    ["GAS", "Your gas report"],
    ["LIFT_STUCK", "Your lift report"],
    ["SHOCK", "Your electric shock report"],
  ] as const)("the category %s reads '%s'", (category, words) => {
    expect(text(alertHtml({ state: "SENT", category, seenAt: null, callPhone: "5900000001" }))).toContain(words);
  });

  it("D153 MEDICAL_VIOLENCE has no specific wording: it says 'Your report', never a guessed category", () => {
    const html = text(alertHtml({ state: "SENT", category: "MEDICAL_VIOLENCE", seenAt: null, callPhone: "5900000001" }));
    expect(html).toContain("Your report has gone to the duty manager");
  });

  it("a declared danger with no word says 'Your report', never a guessed category", () => {
    const none = text(alertHtml({ state: "SENT", category: null, seenAt: null, callPhone: "5900000001" }));
    expect(none).toContain("Your report has gone to the duty manager");
  });
});

describe("D126 alert 1b: seen", () => {
  const seenAt = Date.UTC(2026, 9, 27, 12, 12);
  const html = alertHtml({ state: "SEEN", category: "FIRE", seenAt, callPhone: "5900000001" });

  it("says the duty manager has seen it, with the time, and keeps the same call button", () => {
    expect(text(html)).toContain("The duty manager has seen your report");
    expect(text(html)).toMatch(/Seen at 5:42 pm\. If anyone is in danger, call now\./);
    expect(html).toMatch(/<a [^>]*bg-accent[^>]*href="tel:5900000001"/);
    expect(text(html)).toContain("Call duty manager");
  });
});

describe("D126 alert 1c: no answer", () => {
  it("says 'No answer yet. Call <number> now.' with the emergency number when configured", () => {
    const html = alertHtml({ state: "NO_ANSWER", category: "GAS", seenAt: null, callPhone: "112" });
    expect(text(html)).toContain("No answer yet");
    expect(text(html)).toContain("Call 112 now.");
    expect(html).toMatch(/<a [^>]*bg-accent[^>]*href="tel:112"[^>]*>(<svg[\s\S]*?<\/svg>)?Call 112<\/a>/);
  });

  it("with the duty manager's number when no emergency number is set", () => {
    const html = alertHtml({ state: "NO_ANSWER", category: "GAS", seenAt: null, callPhone: "5900000001" });
    expect(text(html)).toContain("Call 5900000001 now.");
  });

  it("with no number at all, says so in words and draws no link to nowhere", () => {
    for (const state of ["SENT", "SEEN", "NO_ANSWER"] as const) {
      const html = alertHtml({ state, category: null, seenAt: null, callPhone: null });
      expect(html, state).not.toContain("tel:");
      expect(text(html), state).toContain("No phone number is set for this.");
    }
  });
});

describe("D126 the Home with an open safety complaint: the slot and the outlined Pay (D58)", () => {
  const html = render(homeWith(safety()));

  it("shows the alert ABOVE the dues", () => {
    expect(html.indexOf("Your fire report has gone to the duty manager")).toBeGreaterThan(-1);
    expect(html.indexOf("Your fire report has gone to the duty manager")).toBeLessThan(html.indexOf("Amount due"));
  });

  it("the Pay button is OUTLINED, not filled, and the alert's Call link is the one filled control", () => {
    const pay = /<button[^>]*>Pay ₹[\d,]+<\/button>/.exec(html)?.[0] ?? "";
    expect(pay).toContain("border-control");
    expect(pay).not.toContain("bg-accent");
    expect(count(pageOnly(html), /bg-accent/g)).toBe(1);
    expect(pageOnly(html)).toMatch(/<a [^>]*bg-accent[^>]*href="tel:5900000001"/);
  });

  it("the Pay button in the review sheet's footer is outlined too", () => {
    const footers = html.match(/<button[^>]*>Pay ₹[\d,]+<\/button>/g) ?? [];
    expect(footers.length).toBeGreaterThanOrEqual(2);
    for (const pay of footers) expect(pay).not.toContain("bg-accent");
  });

  it("without a safety complaint there is no alert and Pay is filled (the normal Home)", () => {
    const plain = render(homeWith(null));
    expect(plain).not.toContain('role="alert"');
    expect(plain).not.toContain("report has gone");
    expect(plain).toMatch(/<button[^>]*bg-accent[^>]*>Pay ₹[\d,]+<\/button>/);
  });

  it("alert 1b is shown only after the acknowledgement, 1c only after the timeout", () => {
    expect(text(render(homeWith(safety(), DEMO_NOW)))).not.toContain("has seen your report");
    expect(text(render(homeWith(safety(), DEMO_NOW)))).not.toContain("No answer yet");
    expect(text(render(homeWith(safety({ acknowledgedAt: new Date(DEMO_NOW) }), DEMO_NOW)))).toContain("The duty manager has seen your report");
    expect(text(render(homeWith(safety(), DEMO_NOW + 5 * MIN)))).toContain("No answer yet");
  });
});

describe("T13b the Home complaints section", () => {
  const html = render(homeWith(null));

  it("has the header link 'Raise a complaint' to /complaints/new, 48px tall, not filled", () => {
    const link = /<a [^>]*href="\/complaints\/new"[^>]*>Raise a complaint<\/a>/.exec(html)?.[0] ?? "";
    expect(link).toContain("min-h-12");
    expect(link).not.toContain("bg-accent");
  });

  it("the complaint card links to its detail page", () => {
    const data = homeWith(null);
    expect(html).toContain(`href="/complaints/${data.complaint?.id}"`);
  });
});
