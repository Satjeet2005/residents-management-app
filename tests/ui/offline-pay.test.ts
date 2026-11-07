import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayControl } from "@/app/(resident)/pay-control";

const render = (offline: boolean) => renderToStaticMarkup(h(PayControl, { amountPaise: 646800n, openBills: 1, state: { phase: "idle" }, onPay: () => undefined, offline }));

describe("T15 design state O: Pay while offline", () => {
  it("is the dashed, disabled control with the same label, so it never depends on colour", () => {
    const out = render(true);
    expect(out).toMatch(/<button[^>]*disabled/);
    expect(out).toContain("border-dashed");
    expect(out).toContain("Pay ₹6,468");
  });

  it("is the ordinary filled Pay when online", () => {
    const out = render(false);
    expect(out).not.toMatch(/<button[^>]*disabled/);
    expect(out).not.toContain("border-dashed");
  });
});
