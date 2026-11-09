import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaffBackLink, StaffHomeBanner } from "@/app/(staff)/back-link";

let pathname = "/staff";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

describe("SH5 the back link of the staff pages (D188)", () => {
  it.each(["/staff/complaints", "/staff/complaints/abc", "/staff/reports/dues", "/staff/reconciliation"])("%s has the link, named Back to staff home", (path) => {
    pathname = path;
    const out = renderToStaticMarkup(h(StaffBackLink));
    expect(out).toContain('aria-label="Back to staff home"');
    expect(out).toContain(">Staff home<");
  });

  it("the staff home itself has no link to itself", () => {
    pathname = "/staff";
    expect(renderToStaticMarkup(h(StaffBackLink))).toBe("");
  });

  it("the reconciliation workspace draws its own breadcrumb, so the layout draws nothing there", () => {
    pathname = "/staff/reconciliation/11111111-2222-3333-4444-555555555555";
    expect(renderToStaticMarkup(h(StaffBackLink))).toBe("");
  });

  it("the report overview draws its own link (for a person with another tool), so the layout draws nothing there (D236)", () => {
    pathname = "/staff/reports";
    expect(renderToStaticMarkup(h(StaffBackLink))).toBe("");
  });

  it("the report's section pages keep the link from the layout", () => {
    pathname = "/staff/reports/dues";
    expect(renderToStaticMarkup(h(StaffBackLink))).toContain(">Staff home<");
  });

  it("the banner is the same link, named Back to staff home", () => {
    const out = renderToStaticMarkup(h(StaffHomeBanner));
    expect(out).toContain('aria-label="Back to staff home"');
    expect(out).toContain(">Staff home<");
  });
});
