import { describe, expect, it } from "vitest";
import { SECTIONS, overviewHref, sectionFromSlug, sectionHref } from "@/lib/reports/sections";

describe("SC1 the four section pages of the committee report", () => {
  it("are collections, dues, complaints and bank, in that order, each naming a headline of the report", () => {
    expect(SECTIONS.map((s) => s.slug)).toEqual(["collections", "dues", "complaints", "bank"]);
    expect(SECTIONS.map((s) => s.headline)).toEqual(["money", "owed", "complaints", "bank"]);
  });

  it("the month selector applies to collections and complaints only", () => {
    expect(SECTIONS.filter((s) => s.monthly).map((s) => s.slug)).toEqual(["collections", "complaints"]);
  });

  it("a slug is exactly one of the four; anything else is null", () => {
    for (const s of SECTIONS) expect(sectionFromSlug(s.slug)).toBe(s.slug);
    for (const bad of ["", "Collections", "money", "dues/", "../dues", "dues?x=1", "__proto__", "constructor"]) expect(sectionFromSlug(bad), bad).toBeNull();
  });

  it("addresses carry the month", () => {
    expect(sectionHref("dues", "2026-10-01")).toBe("/staff/reports/dues?period=2026-10");
    expect(overviewHref("2026-09-01")).toBe("/staff/reports?period=2026-09");
  });
});
