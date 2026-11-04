import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import { LedgerLine } from "@/components/ui/ledger-line";
import { LedgerTotal } from "@/components/ui/ledger-total";
import { Money } from "@/components/ui/money";
import { Notice } from "@/components/ui/notice";
import { DoubleRule, Hairline } from "@/components/ui/rules";
import { SectionHeader } from "@/components/ui/section-header";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusTag } from "@/components/ui/status-tag";
import { Tracker, type TrackerStep } from "@/components/ui/tracker";

const html = renderToStaticMarkup;
const steps = (...states: TrackerStep["state"][]): TrackerStep[] => states.map((state, i) => ({ label: `Step label ${i + 1}`, state }));

describe("T2 component semantics", () => {
  it("T2 Button is type=button by default, and submit only when asked", () => {
    expect(html(h(Button, null, "Pay"))).toContain('type="button"');
    expect(html(h(Button, { type: "submit" }, "Pay"))).toContain('type="submit"');
  });

  it("T2 a disabled Button is a dashed outline with the disabled attribute, not only a different colour", () => {
    const out = html(h(Button, { disabled: true }, "Pay"));
    expect(out).toContain("disabled");
    expect(out).toContain("border-dashed");
    expect(out).not.toContain("bg-accent");
  });

  it("T2 a loading Button says so in words, is aria-busy and cannot be clicked", () => {
    const out = html(h(Button, { loading: true, loadingLabel: "Paying" }, "Pay"));
    expect(out).toContain("Paying");
    expect(out).not.toContain(">Pay<");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("disabled");
  });

  it("T2 Button variants differ: primary is filled, outlined has a control border, link is underlined", () => {
    expect(html(h(Button, null, "x"))).toContain("bg-accent");
    expect(html(h(Button, { variant: "outlined" }, "x"))).toContain("border-control");
    expect(html(h(Button, { variant: "link" }, "x"))).toContain("underline");
  });

  it("T2 StatusTag always contains its text, with or without an icon", () => {
    expect(html(h(StatusTag, { tone: "caution", children: "Overdue" }))).toContain("Overdue");
    const withIcon = html(h(StatusTag, { tone: "positive", icon: "✓", children: "Paid" }));
    expect(withIcon).toContain("Paid");
    expect(withIcon).toContain('aria-hidden="true"');
  });

  it("T2 Tracker exposes Step 2 of 4 as text, aria-current on the current step only, and works with 3 or 4 steps", () => {
    const four = html(h(Tracker, { steps: steps("done", "current", "upcoming", "upcoming") }));
    expect(four).toContain("Step 2 of 4");
    expect(four.match(/aria-current="step"/g)).toHaveLength(1);
    expect(four.match(/<li/g)).toHaveLength(4);
    expect(four).toContain("<ol");
    const three = html(h(Tracker, { steps: steps("done", "done", "current") }));
    expect(three).toContain("Step 3 of 3");
    expect(three.match(/<li/g)).toHaveLength(3);
  });

  it("T2 Tracker connectors are solid after done steps and dashed after the others; the last step has none", () => {
    const out = html(h(Tracker, { steps: steps("done", "current", "upcoming") }));
    expect(out.match(/after:border-solid/g)).toHaveLength(1);
    expect(out.match(/after:border-dashed/g)).toHaveLength(1);
  });

  it("T2 Tracker marks every state in words for a screen reader, and the all-done tracker is the last step", () => {
    const out = html(h(Tracker, { steps: steps("done", "done", "done") }));
    expect(out).toContain("Done: ");
    expect(out).toContain("Step 3 of 3");
    expect(html(h(Tracker, { steps: steps("upcoming", "upcoming", "upcoming") }))).toContain("Step 1 of 3");
  });

  it("T2 Sheet is a <dialog> whose title labels it, with a Close button and an optional footer", () => {
    const out = html(h(Sheet, { open: false, onClose: () => undefined, title: "Pay maintenance", footer: "Footer text", children: "Body text" }));
    expect(out).toContain("<dialog");
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(out).toContain(`<h2 id="${labelledBy}"`);
    expect(out).toContain("Pay maintenance");
    expect(out).toContain(">Close<");
    expect(out).toContain("Footer text");
    expect(out).toContain("overflow-y-auto");
    expect(out).toContain("sticky");
    expect(html(h(Sheet, { open: false, onClose: () => undefined, title: "T", children: "B" }))).not.toContain("sticky");
  });

  it("T2 Money uses Indian grouping and the tabular class", () => {
    const small = html(h(Money, { amount: 646800n }));
    expect(small).toContain("₹6,468");
    expect(small).toContain("tnum");
    expect(html(h(Money, { amount: 12345600n, size: "hero" }))).toContain("₹1,23,456");
    expect(html(h(Money, { amount: 12345600n, size: "hero" }))).toContain("text-hero");
    expect(html(h(Money, { amount: 100n, size: "large" }))).toContain("text-heading");
  });

  it("T2 Skeleton is aria-busy and names what it is doing", () => {
    const out = html(h(Skeleton, { lines: 4 }));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Loading");
    expect(out.match(/rounded-control bg-paper-2/g)).toHaveLength(4);
  });

  it("T2 Notice is role=status by default and role=alert when asked", () => {
    expect(html(h(Notice, { children: "You are offline" }))).toContain('role="status"');
    expect(html(h(Notice, { kind: "alert", children: "Payment failed" }))).toContain('role="alert"');
  });

  it("T2 BlockError is an alert with the message, the consequence and a Try again button", () => {
    const out = html(h(BlockError, { message: "We could not load your bills.", consequence: "You can't pay right now.", onRetry: () => undefined }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("We could not load your bills.");
    expect(out).toContain("You can&#x27;t pay right now.");
    expect(out).toContain(">Try again<");
  });

  it("T2 LedgerLine shows date, particulars and amount; LedgerTotal ends in a double rule", () => {
    const line = html(h("ul", null, h(LedgerLine, { date: "05 Aug", particulars: "Maintenance, August", amount: 637000n })));
    expect(line).toContain("05 Aug");
    expect(line).toContain("Maintenance, August");
    expect(line).toContain("₹6,370");
    const total = html(h(LedgerTotal, { label: "Amount due", amount: 646800n }));
    expect(total).toContain("Amount due");
    expect(total).toContain("₹6,468");
    expect(total.endsWith(html(h(DoubleRule)) + "</div>")).toBe(true);
  });

  it("T2 DoubleRule is two 2px lines and a 3px gap (7px), decorative; Hairline is a 1px rule", () => {
    const rule = html(h(DoubleRule));
    expect(rule).toContain("h-[7px]");
    expect(rule).toContain("border-y-2");
    expect(rule).toContain('aria-hidden="true"');
    expect(html(h(Hairline))).toContain("<hr");
  });

  it("T2 SectionHeader is a heading with an optional link", () => {
    expect(html(h(SectionHeader, { title: "Recent complaints" }))).toContain("<h2");
    const withLink = html(h(SectionHeader, { title: "Recent complaints", action: { label: "See all", href: "/complaints" } }));
    expect(withLink).toContain('href="/complaints"');
    expect(withLink).toContain(">See all<");
  });
});
