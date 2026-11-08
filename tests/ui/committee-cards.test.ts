import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AlertStrip } from "@/app/(staff)/staff/reports/alert-strip";
import { HeadlineCards } from "@/app/(staff)/staff/reports/headline-cards";
import { AGE_BUCKETS } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
import { trendDescription } from "@/lib/reports/visuals";
import { emptyReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("AL1 the alert strip", () => {
  it("is absent when no safety complaint is waiting", () => {
    expect(html(h(AlertStrip, { count: 0, canManageComplaints: true }))).toBe("");
  });

  it("links to the safety view for a viewer who may manage complaints, in the singular and the plural", () => {
    const one = html(h(AlertStrip, { count: 1, canManageComplaints: true }));
    expect(one).toContain('href="/staff/complaints?view=safety"');
    expect(words(one)).toContain("1 safety complaint is open and not yet seen by the duty manager.");
    const many = html(h(AlertStrip, { count: 3, canManageComplaints: true }));
    expect(words(many)).toContain("3 safety complaints are open and not yet seen by the duty manager.");
  });

  it("is plain text, with no link, for a viewer without complaints:manage", () => {
    const out = html(h(AlertStrip, { count: 2, canManageComplaints: false }));
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
    expect(words(out)).toContain("2 safety complaints are open and not yet seen by the duty manager.");
  });

  it("is a status with an icon and the words, not colour alone, and its link is a 48px target", () => {
    const out = html(h(AlertStrip, { count: 1, canManageComplaints: true }));
    expect(out).toContain('role="status"');
    expect(out).toContain("<svg");
    expect(out).toContain("min-h-12");
  });
});

const money: MoneyLine = { billedPaise: 1_805_219_000n, collectedPaise: 1_484_271_400n, outstandingPaise: 320_947_600n, flatsBilled: 10, flatsPaidInFull: 8, flatsOutstanding: 2, fees: { postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 0n } };
const ageing = { buckets: AGE_BUCKETS.map((bucket) => ({ bucket, flats: 1, bills: 1, amountDuePaise: 1n })), total: { flats: 817, bills: 900, amountDuePaise: 606_000_000n } };

describe("HC1 the four headline cards", () => {
  const out = html(h(HeadlineCards, { report: emptyReport({ money, ageing }) }));

  it("has four cards in the order Collected, Total owed, Paid on time, Replies within the SLA, each with an h2 label", () => {
    const labels = [...out.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Collected this month", "Total owed", "Paid on time", "Replies within the SLA"]);
  });

  it("the collected card shows the percent, both amounts in short form, the exact figure in full grouping, a progress bar and no goal", () => {
    const text = words(out);
    expect(text).toContain("₹1.48 crore of ₹1.81 crore");
    expect(text).toContain("₹1,48,42,714 of ₹1,80,52,190");
    expect(out).toContain('aria-labelledby="m1-collected-title m1-collected-desc"');
    const card = out.split("<li class=")[1];
    expect(card).not.toContain("Goal");
  });

  it("the owed card shows the total, its flats and the flats over 90 days, and no chart", () => {
    const card = words(out.split("<li class=")[2]);
    expect(card).toContain("₹60.6 lakh");
    expect(card).toContain("817 flats");
    expect(card).toContain("1 flat is over 90 days");
    expect(out.split("<li class=")[2]).not.toContain("<svg");
  });

  it("the two goal cards say 'No data' and show no verdict when there is nothing to measure, and still carry a sparkline with a table", () => {
    for (const index of [3, 4]) {
      const card = out.split("<li class=")[index];
      expect(words(card)).toContain("No data");
      expect(card).not.toContain("Not met");
      expect(card).not.toMatch(/>Met</);
      expect(card).toContain("<svg");
      expect(card).toContain("Show as a table");
    }
  });
});

describe("HC2 goals in words with an icon", () => {
  const withGoals = (onTime: number, sla: number) =>
    html(
      h(HeadlineCards, {
        report: emptyReport({
          cards: {
            ...emptyReport().cards,
            onTime: { ...emptyReport().cards.onTime, goal: { key: "onTimeCollection", status: onTime > 0 ? "MET" : "NOT_MET", targetPercent: 90, text: "Goal: At least 90%" } },
            sla: { ...emptyReport().cards.sla, goal: { key: "firstReplyWithinSla", status: sla > 0 ? "MET" : "NOT_MET", targetPercent: 90, text: "Goal: At least 90%" } },
          },
        }),
      }),
    );

  it("Met has a check icon and the word, Not met a warning icon and the words", () => {
    const met = withGoals(1, 0);
    const onTimeCard = met.split("<li class=")[3];
    const slaCard = met.split("<li class=")[4];
    expect(words(onTimeCard)).toContain("Met");
    expect(onTimeCard).toContain("<svg");
    expect(words(slaCard)).toContain("Not met");
    expect(words(onTimeCard)).toContain("Goal: At least 90%");
  });
});

describe("HC3 the computed takeaway of a trend", () => {
  const goal = { key: "onTimeCollection" as const, status: "NOT_MET" as const, targetPercent: 90, text: "Goal: At least 90%" };
  it("names the latest value, its movement from the one before (skipping a gap), and the goal verdict", () => {
    expect(trendDescription([{ label: "Aug", value: 80 }, { label: "Sep", value: null }, { label: "Oct", value: 70 }], goal)).toBe("Oct was 70%, down from Aug (80%). Goal: At least 90%: Not met.");
    expect(trendDescription([{ label: "Sep", value: 60 }, { label: "Oct", value: 70 }], { ...goal, status: "MET" })).toBe("Oct was 70%, up from Sep (60%). Goal: At least 90%: Met.");
    expect(trendDescription([{ label: "Sep", value: 70 }, { label: "Oct", value: 70 }], goal)).toContain("the same as Sep");
  });

  it("a single value, and no value at all", () => {
    expect(trendDescription([{ label: "Oct", value: 70 }], { ...goal, status: "NO_DATA" })).toBe("Oct was 70%.");
    expect(trendDescription([{ label: "Sep", value: null }, { label: "Oct", value: null }], goal)).toBe("No data in this period.");
  });
});
