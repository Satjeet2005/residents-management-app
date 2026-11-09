import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { emptyReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

describe("CC1 the overview has no section choice", () => {
  const out = renderToStaticMarkup(h(ReportView, { report: emptyReport() }));

  it("has no Choose sections button, no sheet, no checkbox and no collapsible section", () => {
    expect(out).not.toContain("Choose sections");
    expect(out).not.toContain("<dialog");
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain("data-section");
  });
});
