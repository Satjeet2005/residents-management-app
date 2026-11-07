import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComplaintsView } from "@/app/(resident)/complaints/complaints-view";
import { complaintStatusLabel } from "@/lib/complaint-text";
import type { ComplaintListData } from "@/server/complaints/page-data";
import type { OwnComplaintLine } from "@/server/complaints/read";

const render = (data: ComplaintListData) => renderToStaticMarkup(h(ComplaintsView, { data }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const line = (over: Partial<OwnComplaintLine>): OwnComplaintLine => ({
  id: "0b8f1f3a-0000-4000-8000-000000000001",
  title: "Water leak under the sink",
  status: "ASSIGNED",
  current: 1,
  needsAnswer: false,
  reply: { kind: "DUE", dueAt: Date.UTC(2026, 10, 6, 11, 30), today: true },
  replyText: "Reply due today, 5 pm",
  createdAt: 0,
  ...over,
});

describe("T13b /complaints with open and closed complaints", () => {
  const data: ComplaintListData = {
    kind: "OK",
    open: [line({}), line({ id: "0b8f1f3a-0000-4000-8000-000000000002", title: "Gas smell", status: "PENDING_CONFIRMATION", current: 3, reply: null })],
    closed: [line({ id: "0b8f1f3a-0000-4000-8000-000000000003", title: "Lift button", status: "CLOSED", current: 3, reply: null })],
  };
  const html = render(data);
  const words = text(html);

  it("has one h1 and a main landmark", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toContain("<main");
    expect(words).toContain("Your complaints");
  });

  it("has exactly one filled control: the Raise a complaint link to /complaints/new, 48px tall", () => {
    expect(count(html, /bg-accent/g)).toBe(1);
    const raise = /<a [^>]*href="\/complaints\/new"[^>]*>Raise a complaint<\/a>/.exec(html)?.[0] ?? "";
    expect(raise).toContain("bg-accent");
    expect(raise).toContain("min-h-12");
  });

  it("shows each open complaint with its status word, its tracker, 'Step n of 4' and the reply line, as a link to its page", () => {
    expect(words).toContain("Water leak under the sink");
    expect(words).toContain("Step 2 of 4. Reply due today,");
    expect(words).toContain("Step 4 of 4");
    expect(words).toContain("Assigned");
    expect(words).toContain("Marked fixed");
    expect(count(html, /aria-label="Complaint progress"/g)).toBe(2);
    expect(html).toContain('href="/complaints/0b8f1f3a-0000-4000-8000-000000000001"');
    expect(html).toContain('href="/complaints/0b8f1f3a-0000-4000-8000-000000000002"');
  });

  it("puts the closed complaints in a collapsed 'Closed (1)' section after the open ones", () => {
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*><summary[^>]*>Closed \(1\)<\/summary>/);
    expect(html.indexOf("Lift button")).toBeGreaterThan(html.indexOf("Gas smell"));
    expect(html.indexOf("Closed (1)")).toBeGreaterThan(html.indexOf("Gas smell"));
    const summary = /<summary[^>]*>/.exec(html)?.[0] ?? "";
    expect(summary).toContain("min-h-12");
  });

  it("separates cards by 12px (gap-3), more than the 8px minimum, and uses 16px body text", () => {
    expect(html).toContain("flex flex-col gap-3");
    expect(html).toContain("text-body");
  });
});

describe("T13b /complaints states", () => {
  it("none open: says 'No open complaints' in words, keeps the one Raise control, and shows no Closed section", () => {
    const html = render({ kind: "OK", open: [], closed: [] });
    expect(text(html)).toContain("No open complaints");
    expect(count(html, /bg-accent/g)).toBe(1);
    expect(html).not.toContain("<details");
  });

  it("none open but some closed: still says none open, and the closed ones are collapsed", () => {
    const html = render({ kind: "OK", open: [], closed: [line({ status: "CLOSED", current: 3, reply: null })] });
    expect(text(html)).toContain("No open complaints");
    expect(text(html)).toContain("Closed (1)");
  });

  it("no flat: says so and draws no Raise control (it would not work)", () => {
    const html = render({ kind: "NO_FLAT" });
    expect(text(html)).toContain("No flat is linked to your account yet");
    expect(html).not.toContain("/complaints/new");
    expect(count(html, /bg-accent/g)).toBe(0);
  });

  it("every status has a word", () => {
    expect(["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "REOPENED", "CLOSED"].map((s) => complaintStatusLabel(s as never))).toEqual([
      "Raised", "Assigned", "In progress", "Marked fixed", "Reopened", "Closed",
    ]);
  });
});
