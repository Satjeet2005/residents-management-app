import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ComplaintsError from "@/app/(resident)/complaints/error";
import ResidentError from "@/app/(resident)/error";
import StaffError from "@/app/(staff)/error";
import StaffComplaintsError from "@/app/(staff)/staff/complaints/error";
import ReconciliationError from "@/app/(staff)/staff/reconciliation/error";
import ReportsError from "@/app/(staff)/staff/reports/error";
import RootError from "@/app/error";
import { t } from "@/lib/messages";

/** D135: every error boundary says something went wrong, shows the reference (the digest Next gives the browser) and keeps Try again. */

const BOUNDARIES: [string, (props: { error: Error & { digest?: string }; reset: () => void }) => React.ReactElement][] = [
  ["the resident home", ResidentError],
  ["the resident complaints", ComplaintsError],
  ["the staff layout", StaffError],
  ["the staff complaints", StaffComplaintsError],
  ["the staff reconciliation", ReconciliationError],
  ["the staff reports", ReportsError],
  ["the root", RootError],
];
const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const render = (Boundary: (typeof BOUNDARIES)[number][1], error: Error & { digest?: string }) => renderToStaticMarkup(h(Boundary, { error, reset: () => undefined }));

describe("D135 the error boundaries", () => {
  it.each(BOUNDARIES)("%s shows the reference from the digest and keeps Try again", (_name, Boundary) => {
    const out = text(render(Boundary, Object.assign(new Error("secret detail"), { digest: "3175611538" })));
    expect(out).toContain("Reference: 3175611538");
    expect(out).toContain("Try again");
  });

  it.each(BOUNDARIES)("%s never shows the error message or stack", (_name, Boundary) => {
    const error = Object.assign(new Error("relation otp_codes does not exist"), { digest: "42" });
    error.stack = "Error: boom\n    at secretFunction (/app/secret.ts:1:1)";
    expect(render(Boundary, error)).not.toMatch(/otp_codes|secretFunction|secret\.ts/);
  });

  it.each(BOUNDARIES)("%s shows no reference line when there is no digest (a client-side error)", (_name, Boundary) => {
    expect(text(render(Boundary, new Error("x")))).not.toContain("Reference");
  });

  it("the root and staff layout boundaries say 'Something went wrong.' from the message catalog", () => {
    expect(t("error.title")).toBe("Something went wrong.");
    expect(t("error.reference", { ref: "E-ABC234" })).toBe("Reference: E-ABC234");
    for (const Boundary of [RootError, StaffError]) expect(text(render(Boundary, Object.assign(new Error("x"), { digest: "1" })))).toContain("Something went wrong.");
  });

  it("the reference is an alert region's text, so a screen reader reads it with the message", () => {
    const out = render(RootError, Object.assign(new Error("x"), { digest: "7" }));
    expect(out).toMatch(/role="alert"[\s\S]*Reference: 7/);
  });
});
