import { describe, expect, it } from "vitest";
import { URGENCIES } from "@/domain/complaints/taxonomy";
import { categoryLabel, confidenceWords, sourceName, sourceTag, staffStatusLabel, urgencyLabel, urgencyTone } from "@/lib/staff-complaints/labels";

describe("SC6 where the classification came from", () => {
  it.each([
    ["RULE", "Rules"],
    ["LLM", "Model"],
    ["FALLBACK", "Keywords"],
    ["MANUAL", "Manual"],
  ] as const)("%s is the tag %s", (source, text) => {
    expect(sourceTag({ source, needsReview: false })).toEqual({ text, tone: "neutral" });
    expect(sourceName(source)).toBe(text);
  });

  it("a complaint that needs review is tagged Needs review whatever its source, in the caution tone", () => {
    for (const source of ["RULE", "LLM", "FALLBACK", "MANUAL", null] as const) {
      expect(sourceTag({ source, needsReview: true })).toEqual({ text: "Needs review", tone: "caution" });
    }
  });

  it("no classification and no review is no tag", () => {
    expect(sourceTag({ source: null, needsReview: false })).toBeNull();
  });
});

describe("SC7 words for the columns", () => {
  it("staff read a resolved complaint as Waiting for resident", () => {
    expect(staffStatusLabel("PENDING_CONFIRMATION")).toBe("Waiting for resident");
    expect(["NEW", "ASSIGNED", "IN_PROGRESS", "REOPENED", "CLOSED"].map((s) => staffStatusLabel(s as never))).toEqual(["New", "Assigned", "In progress", "Reopened", "Closed"]);
  });

  it("only CRITICAL takes the caution tone, and every urgency has its word", () => {
    expect(URGENCIES.map(urgencyLabel)).toEqual(["Critical", "High", "Normal", "Low"]);
    expect(URGENCIES.map(urgencyTone)).toEqual(["caution", "neutral", "neutral", "neutral"]);
  });

  it("categories have words, and a missing or unknown one is No category", () => {
    expect(["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"].map(categoryLabel)).toEqual(["Plumbing", "Electrical", "Housekeeping", "Lift", "Other"]);
    expect(categoryLabel(null)).toBe("No category");
    expect(categoryLabel("WEATHER")).toBe("No category");
  });

  it.each([
    [null, "No confidence score"],
    [0.99, "High confidence"],
    [0.85, "High confidence"],
    [0.849, "Medium confidence"],
    [0.7, "Medium confidence"],
    [0.699, "Low confidence"],
    [0, "Low confidence"],
  ])("confidence %s is %s", (value, words) => {
    expect(confidenceWords(value)).toBe(words);
  });
});
