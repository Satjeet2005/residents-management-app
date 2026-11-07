import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionsView, type ActionsViewProps } from "@/app/(resident)/complaints/[id]/actions-view";
import { ComplaintView } from "@/app/(resident)/complaints/[id]/complaint-view";
import { initialActionState } from "@/lib/complaint-actions";
import type { ComplaintDetailData } from "@/server/complaints/page-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

type Ok = Extract<ComplaintDetailData, { kind: "OK" }>;
const at = Date.UTC(2026, 10, 3, 6, 30);
const base = {
  id: "0b8f1f3a-0000-4000-8000-000000000001",
  title: "Water leak under the sink",
  status: "PENDING_CONFIRMATION" as const,
  current: 3 as const,
  needsAnswer: true,
  reply: null,
  replyText: null,
  createdAt: at,
  body: "Water leak under the sink",
  flatCode: "T12-0408",
  safety: false,
  rating: null,
  closeKind: null,
  reopenCount: 0,
  canReopen: true,
  timeline: [
    { kind: "RAISED" as const, label: "Raised", at, text: null },
    { kind: "ASSIGNED" as const, label: "Assigned", at: at + 3_600_000, text: null },
    { kind: "COMMENT" as const, label: "Update from the society", at: at + 7_200_000, text: "Plumber visits tomorrow" },
    { kind: "RESOLVED" as const, label: "Marked resolved. Please confirm or reopen", at: at + 86_400_000, text: null },
  ],
};
const data = (over: Partial<Ok["complaint"]>, autoCloseDays = 7): Ok => ({ kind: "OK", complaint: { ...base, ...over }, autoCloseDays });
const render = (d: Ok, sent = false) => renderToStaticMarkup(h(ComplaintView, { data: d, sent }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("T13b detail: needs your answer (design 4a)", () => {
  const html = render(data({}));
  const words = text(html);

  it("has one h1 with the title, the status tag in words, the tracker and the timeline with dates and labels", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Water leak under the sink<\/h1>/);
    expect(words).toContain("Marked fixed");
    expect(html).toContain('aria-label="Complaint progress"');
    expect(words).toContain("Step 4 of 4");
    expect(words).toContain("3 Nov");
    expect(words).toContain("Update from the society Plumber visits tomorrow");
    expect(words).toContain("Marked resolved. Please confirm or reopen");
  });

  it("asks 'Is it fixed?' with two equal-weight outlined buttons, 48px tall, and the auto-close line with the setting's number", () => {
    expect(words).toContain("Is it fixed?");
    const buttons = html.match(/<button[^>]*>(Yes, it&#x27;s fixed|No, still a problem)<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain("border-control");
      expect(button).not.toContain("bg-accent");
      expect(button).toContain("min-h-12");
    }
    expect(words).toContain("It closes by itself after 7 days if you don't answer.");
    expect(count(html, /bg-accent/g)).toBe(0);
  });

  it("the auto-close number comes from the setting", () => {
    expect(text(render(data({}, 3)))).toContain("after 3 days");
  });

  it("the banner appears only after raising", () => {
    expect(words).not.toContain("We have your complaint");
    expect(text(render(data({}), true))).toContain("We have your complaint. You can follow it here.");
  });
});

describe("T13b detail: a safety complaint (design 4b, D39)", () => {
  const html = render(data({ safety: true }));
  const words = text(html);

  it("says the duty manager will confirm it, offers only 'Still a problem', and has NO auto-close line and NO 'Yes, it's fixed'", () => {
    expect(words).toContain("The duty manager will confirm this one.");
    expect(html).toMatch(/<button[^>]*>Still a problem<\/button>/);
    expect(words).not.toContain("closes by itself");
    expect(words).not.toContain("Yes, it's fixed");
    expect(words).not.toContain("No, still a problem");
    expect(words).not.toContain("Is it fixed?");
  });

  it("the banner for a safety complaint says it went to the duty manager", () => {
    expect(text(render(data({ safety: true }), true))).toContain("Your report has gone to the duty manager.");
  });

  it("closed by the duty manager: read-only text, and 'Still a problem' only inside the reopen window, never an auto-close line", () => {
    const closed = text(render(data({ safety: true, status: "CLOSED", closeKind: "DUTY_MANAGER", canReopen: true })));
    expect(closed).toContain("Closed by the duty manager.");
    expect(closed).toContain("Still a problem");
    expect(closed).not.toContain("closes by itself");
    const late = render(data({ safety: true, status: "CLOSED", closeKind: "DUTY_MANAGER", canReopen: false }));
    expect(late).not.toContain("<button");
  });
});

describe("T13b detail: the other states are read-only text", () => {
  it.each([
    ["CONFIRMED", "Closed. You confirmed it is fixed."],
    ["AUTO_CLOSED", "Closed automatically after no answer."],
    ["DUTY_MANAGER", "Closed by the duty manager."],
  ] as const)("a non-safety complaint closed as %s says how, with no button", (closeKind, sentence) => {
    const html = render(data({ status: "CLOSED", closeKind, canReopen: true }));
    expect(text(html)).toContain(sentence);
    expect(html).not.toContain("<button");
    expect(text(html)).not.toContain("closes by itself");
  });

  it("a rating is shown as text", () => {
    expect(text(render(data({ status: "CLOSED", closeKind: "CONFIRMED", rating: 4 })))).toContain("You rated it 4 out of 5.");
  });

  it("a reopened complaint says so and has no button", () => {
    const html = render(data({ status: "REOPENED", current: 1, needsAnswer: false }));
    expect(text(html)).toContain("You said it is still a problem.");
    expect(html).not.toContain("<button");
  });

  it("a complaint in progress has no question and no button", () => {
    const html = render(data({ status: "IN_PROGRESS", current: 2, needsAnswer: false, reply: { kind: "OVERDUE" } }));
    expect(html).not.toContain("<button");
    expect(text(html)).toContain("Step 3 of 4. Reply overdue");
  });
});

describe("T13b the answer steps", () => {
  const props = (over: Partial<ActionsViewProps["state"]>, more: Partial<ActionsViewProps> = {}): ActionsViewProps => ({
    state: { ...initialActionState, ...over },
    safety: false,
    pending: true,
    autoCloseDays: 7,
    onFixed: () => {},
    onProblem: () => {},
    onBack: () => {},
    onRating: () => {},
    onReason: () => {},
    onSend: () => {},
    onReload: () => {},
    ...more,
  });
  const view = (p: ActionsViewProps) => renderToStaticMarkup(h(ActionsView, p));

  it("the rating step has five 48px choices, an optional rating, and a filled Done", () => {
    const html = view(props({ mode: "RATE", rating: 4 }));
    expect(count(html, /aria-label="\d out of 5"/g)).toBe(5);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="4 out of 5"|aria-label="4 out of 5"[^>]*aria-pressed="true"/);
    expect(count(html, /min-h-12 min-w-12/g)).toBe(5);
    expect(html).toMatch(/<button[^>]*bg-accent[^>]*>Done<\/button>/);
    expect(count(html, /bg-accent/g)).toBe(1);
  });

  it("the reason step has a labelled field, a counter, and a filled Send; too short shows the inline error", () => {
    const html = view(props({ mode: "REASON", reason: "abc", reasonInvalid: true }));
    expect(html).toMatch(/<label for="reopen-reason"[^>]*>What is still wrong\?<\/label>/);
    expect(text(html)).toContain("3 of 500 characters");
    expect(text(html)).toContain("Write between 5 and 500 characters.");
    expect(html).toMatch(/<button[^>]*bg-accent[^>]*>Send<\/button>/);
  });

  it("sending shows a loading label; a failure says so with Try again; 409 asks for a reload", () => {
    expect(view(props({ mode: "REASON", reason: "abcde", busy: true }))).toMatch(/aria-busy="true"[^>]*>Sending<\/button>/);
    const failed = view(props({ mode: "RATE", error: "NETWORK" }));
    expect(text(failed)).toContain("We couldn't reach the server.");
    expect(failed).toMatch(/>Try again<\/button>/);
    const stale = view(props({ mode: "RATE", error: "STALE" }));
    expect(text(stale)).toContain("This complaint has changed. Reload to see where it stands.");
    expect(stale).toMatch(/<button[^>]*>Reload<\/button>/);
  });

  it("when done it thanks the person and draws no button", () => {
    const html = view(props({ done: "REOPENED" }));
    expect(text(html)).toContain("Thank you. We have reopened it.");
    expect(html).not.toContain("<button");
  });
});
