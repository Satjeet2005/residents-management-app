import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChooseSections } from "@/app/(staff)/staff/reports/choose-sections";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { SECTION_IDS } from "@/lib/reports/sections";
import { emptyReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }), saveSections: async () => ({ ok: true, data: "SAVED" }) }));

const html = renderToStaticMarkup;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

describe("CC1 the Choose sections control", () => {
  const out = html(h(ChooseSections, { hidden: [] }));

  it("is a 48px outlined button that opens a sheet titled Choose sections", () => {
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Choose sections<\/button>/);
    expect(out).toContain("<dialog");
    expect(out).toMatch(/<h2[^>]*>Choose sections<\/h2>/);
  });

  it("has one checkbox per SECTION in page order, labelled in plain words, and none for the headline cards", () => {
    expect(count(out, /type="checkbox"/g)).toBe(SECTION_IDS.length);
    const labels = [...out.matchAll(/<\/label>|<label[^>]*>[\s\S]*?<\/label>/g)].map((m) => words(m[0]).trim()).filter(Boolean);
    expect(labels).toEqual(["Billed and collected", "What is owed", "How fast bills are paid", "Complaints", "Bank statement matching"]);
    expect(words(out)).not.toMatch(/Money collected for|Total still owed|Complaints answered in time/);
  });

  it("every checkbox row is a 48px target with 8px between rows, and they start checked (everything shown)", () => {
    for (const label of out.match(/<label[^>]*>/g) ?? []) expect(label).toContain("min-h-12");
    expect(out).toContain("gap-2");
    expect(count(out, /checked=""/g)).toBe(5);
  });

  it("has ONE button in the sheet, Done: no Save, no Show everything and no Close; it says each choice is saved at once and the headline figures are always shown", () => {
    const sheet = out.slice(out.indexOf("<dialog"));
    expect(count(sheet, /<button/g)).toBe(1);
    expect(sheet).toContain(">Done<");
    expect(sheet).not.toMatch(/>Save<|>Show everything<|>Close</);
    expect(words(out)).toContain("saved on this device as soon as you make it");
    expect(words(out)).toContain("The four headline figures are always shown.");
  });

  it("starts with the hidden sections unchecked and says how many are hidden", () => {
    const some = html(h(ChooseSections, { hidden: ["owed", "bank"] }));
    expect(count(some, /checked=""/g)).toBe(3);
    expect(words(some)).toContain("2 sections are hidden on this device.");
    expect(words(html(h(ChooseSections, { hidden: ["owed"] })))).toContain("1 section is hidden on this device.");
    expect(words(out)).not.toContain("hidden on this device");
  });
});

describe("CC2 hidden sections are omitted from the HTML", () => {
  it("leaves out a hidden section entirely and keeps the others and the cards", () => {
    const out = html(h(ReportView, { report: emptyReport(), hidden: ["owed", "complaints"] }));
    expect(out).not.toContain('<details id="owed"');
    expect(out).not.toContain('<details id="complaints"');
    for (const id of ["money", "quality", "bank"]) expect(out).toContain(`<details id="${id}"`);
    expect(count(out, /<details id=/g)).toBe(3);
    expect(out).toContain("Money collected for October");
    expect(words(out)).not.toContain("No complaints were raised in this month.");
  });

  it("opens the first two sections that are shown from 768px, not the first two ids", () => {
    const out = html(h(ReportView, { report: emptyReport(), hidden: ["money"] }));
    expect(out).toMatch(/<details id="owed"[^>]*data-default-open="true"/);
    expect(out).toMatch(/<details id="quality"[^>]*data-default-open="true"/);
    expect(out).toMatch(/<details id="complaints"[^>]*data-default-open="false"/);
  });

  it("all sections hidden still has the cards, the selector and About these numbers", () => {
    const out = html(h(ReportView, { report: emptyReport(), hidden: [...SECTION_IDS] }));
    expect(count(out, /<details id=/g)).toBe(0);
    expect(out).toContain("Headline figures");
    expect(words(out)).toContain("About these numbers");
  });
});
