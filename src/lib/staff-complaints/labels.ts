import type { ComplaintStatus } from "@/domain/complaints/step";
import { type CategoryCode, type Urgency, isCategoryCode } from "@/domain/complaints/taxonomy";
import type { StatusTone } from "@/components/ui/status-tag";
import { t } from "@/lib/messages";

/** The status of a complaint as STAFF read it: a resolved complaint is "Waiting for resident", not the resident's "Marked fixed". */
export function staffStatusLabel(status: ComplaintStatus): string {
  switch (status) {
    case "NEW":
      return t("staffComplaints.status.new");
    case "ASSIGNED":
      return t("staffComplaints.status.assigned");
    case "IN_PROGRESS":
      return t("staffComplaints.status.inProgress");
    case "PENDING_CONFIRMATION":
      return t("staffComplaints.status.waiting");
    case "REOPENED":
      return t("staffComplaints.status.reopened");
    case "CLOSED":
      return t("staffComplaints.status.closed");
  }
}

export function urgencyLabel(urgency: Urgency): string {
  switch (urgency) {
    case "CRITICAL":
      return t("staffComplaints.urgency.critical");
    case "HIGH":
      return t("staffComplaints.urgency.high");
    case "NORMAL":
      return t("staffComplaints.urgency.normal");
    case "LOW":
      return t("staffComplaints.urgency.low");
  }
}

/** CRITICAL takes the caution tone, always with its word; the others stay neutral. Colour never carries the meaning alone. */
export const urgencyTone = (urgency: Urgency): StatusTone => (urgency === "CRITICAL" ? "caution" : "neutral");

export function categoryLabel(category: string | null): string {
  if (category === null || !isCategoryCode(category)) return t("staffComplaints.category.none");
  return categoryName(category);
}

export function categoryName(category: CategoryCode): string {
  switch (category) {
    case "PLUMBING":
      return t("staffComplaints.category.plumbing");
    case "ELECTRICAL":
      return t("staffComplaints.category.electrical");
    case "HOUSEKEEPING":
      return t("staffComplaints.category.housekeeping");
    case "LIFT":
      return t("staffComplaints.category.lift");
    case "OTHER":
      return t("staffComplaints.category.other");
  }
}

export type ClassificationSource = "RULE" | "LLM" | "FALLBACK" | "MANUAL";
export type SourceTag = { text: string; tone: StatusTone };

/**
 * The small tag for where the classification came from: "Rules" (a safety rule), "Model" (a language model), "Keywords" (the keyword fallback),
 * "Manual" (a person fixed it). A complaint that waits for a person to look at the category is "Needs review", which wins over the source: it is what
 * the person on the board has to do. No classification at all is no tag.
 */
export function sourceTag(input: { source: ClassificationSource | null; needsReview: boolean }): SourceTag | null {
  if (input.needsReview) return { text: t("staffComplaints.source.needsReview"), tone: "caution" };
  return input.source === null ? null : { text: sourceName(input.source), tone: "neutral" };
}

/** The name of a classification source, without the "needs review" override: the tag on the board and the history on the detail page both use it. */
export function sourceName(source: ClassificationSource): string {
  switch (source) {
    case "RULE":
      return t("staffComplaints.source.rules");
    case "LLM":
      return t("staffComplaints.source.model");
    case "FALLBACK":
      return t("staffComplaints.source.keywords");
    case "MANUAL":
      return t("staffComplaints.source.manual");
  }
}

/** The confidence of a classification in words. A rule or a person has none. Starting guesses: 0.85 and 0.70 (assumption R36 holds the 0.70 line). */
export function confidenceWords(confidence: number | null): string {
  if (confidence === null) return t("staffComplaints.confidence.none");
  if (confidence >= 0.85) return t("staffComplaints.confidence.high");
  if (confidence >= 0.7) return t("staffComplaints.confidence.medium");
  return t("staffComplaints.confidence.low");
}
