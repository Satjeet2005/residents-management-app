import { describe, expect, it } from "vitest";
import { DETAIL_TABS, RECENT_EVENTS, classificationOneLine, tabFromQuery, trimTimeline } from "@/lib/staff-complaints/detail";
import { replyChipWords } from "@/lib/staff-complaints/time";
import type { TimelineLine } from "@/lib/staff-complaints/timeline";

const line = (n: number): TimelineLine => ({ key: `k${n}`, at: n * 1000, who: null, label: `Event ${n}`, text: null, visibility: "internal" });

describe("D152 the tab state", () => {
  it("has the two tabs, Details first", () => {
    expect(DETAIL_TABS).toEqual(["details", "timeline"]);
  });

  it.each([
    ["details", "details"],
    ["timeline", "timeline"],
    [["timeline", "details"], "timeline"],
    [undefined, "details"],
    ["", "details"],
    ["Timeline", "details"],
    ["__proto__", "details"],
    ["timeline,details", "details"],
    ["<script>", "details"],
  ] as const)("?tab=%j is %s", (value, expected) => {
    expect(tabFromQuery(value as string | string[] | undefined)).toBe(expected);
  });
});

describe("D152 event trimming", () => {
  it("shows the latest three, newest first, and the earlier ones newest first", () => {
    const { recent, earlier } = trimTimeline([line(1), line(5), line(3), line(2), line(4)]);
    expect(RECENT_EVENTS).toBe(3);
    expect(recent.map((l) => l.label)).toEqual(["Event 5", "Event 4", "Event 3"]);
    expect(earlier.map((l) => l.label)).toEqual(["Event 2", "Event 1"]);
  });

  it("has nothing earlier for three events or fewer, and does not change its input", () => {
    const input = [line(2), line(1)];
    expect(trimTimeline(input)).toEqual({ recent: [line(2), line(1)], earlier: [] });
    expect(input.map((l) => l.label)).toEqual(["Event 2", "Event 1"]);
    expect(trimTimeline([])).toEqual({ recent: [], earlier: [] });
  });
});

describe("D152 the one-line classification", () => {
  it("reads Source · Category · Urgency", () => {
    expect(classificationOneLine({ source: "RULE", category: "LIFT", urgency: "CRITICAL", confidence: null, latencyMs: 0, outputHash: "x", at: 1 })).toBe("Rules · Lift · Critical");
    expect(classificationOneLine({ source: "LLM", category: null, urgency: "NORMAL", confidence: 0.9, latencyMs: 4, outputHash: "x", at: 1 })).toBe("Model · No category · Normal");
    expect(classificationOneLine(undefined)).toBeNull();
  });
});

describe("D152 the reply chip", () => {
  const NOW = Date.UTC(2026, 10, 7, 6, 30);
  it("says 'Reply overdue 2 h 32 min' (no 'by'), and the usual words otherwise", () => {
    expect(replyChipWords({ sla: "OVERDUE", responseDueAt: NOW - 152 * 60_000, now: NOW })).toBe("Reply overdue 2 h 32 min");
    expect(replyChipWords({ sla: "ON_TIME", responseDueAt: NOW + 40 * 60_000, now: NOW })).toBe("Reply due in 40 min");
    expect(replyChipWords({ sla: "MET", responseDueAt: NOW - 1, now: NOW })).toBe("Replied in time");
    expect(replyChipWords({ sla: "LATE", responseDueAt: NOW - 1, now: NOW })).toBe("Replied late");
    expect(replyChipWords({ sla: "NONE", responseDueAt: null, now: NOW })).toBe("No reply clock");
  });
});
