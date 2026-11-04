import type { ComplaintUrgency } from "./types";

export type ComplaintStatus = "NEW" | "ASSIGNED" | "IN_PROGRESS" | "PENDING_CONFIRMATION" | "CLOSED" | "REOPENED";
export type CloseKind = "CONFIRMED" | "AUTO_CLOSED" | "DUTY_MANAGER";
export type ClassificationSource = "RULE" | "LLM" | "FALLBACK" | "MANUAL";
export type ComplaintEventType =
  | "CREATED"
  | "CLASSIFIED"
  | "ASSIGNED"
  | "STATUS_CHANGED"
  | "COMMENT"
  | "REOPENED"
  | "CATEGORY_CORRECTED"
  | "DUPLICATE_LINKED"
  | "ESCALATED"
  | "AFFECTED_TOO"
  | "CLOSED";

/** Timestamps are epoch milliseconds. Row shape matches the `complaints` table. */
export type DemoComplaint = {
  key: string;
  flatKey: string;
  raisedByUserKey: string;
  body: string;
  categoryCode: string;
  urgency: ComplaintUrgency;
  safetyFlag: boolean;
  status: ComplaintStatus;
  assigneeUserKey: string | null;
  responseDueAt: number;
  firstResponseAt: number | null;
  pendingConfirmationAt: number | null;
  closedAt: number | null;
  closeKind: CloseKind | null;
  rating: number | null;
  reopenCount: number;
  needsReview: boolean;
  createdAt: number;
};

export type DemoComplaintEvent = {
  key: string;
  complaintKey: string;
  type: ComplaintEventType;
  actorUserKey: string | null;
  payload: Record<string, string | number | null>;
  createdAt: number;
};

export type DemoClassification = {
  complaintKey: string;
  source: ClassificationSource;
  categoryCode: string;
  urgency: ComplaintUrgency;
  /** 0.60 to 0.98 for LLM; null for RULE and MANUAL. */
  confidence: number | null;
  createdAt: number;
};

export type DemoComplaintLink = {
  primaryKey: string;
  duplicateKey: string;
  similarity: number;
  linkedByUserKey: string | null;
  createdAt: number;
};

/** "I'm affected too": a flat that did not file its own complaint. */
export type DemoAffected = { complaintKey: string; flatKey: string; createdAt: number };

export type DemoComplaints = {
  complaints: DemoComplaint[];
  events: DemoComplaintEvent[];
  classifications: DemoClassification[];
  links: DemoComplaintLink[];
  affected: DemoAffected[];
};

/** A second trip through the workflow after a resident reopens a closed complaint. */
export type ReopenPlan = { at: number; resolvedAt: number | null; closedAt: number | null; rating: number | null };

/**
 * Everything that happens to one complaint, as times. A time after DEMO_NOW is
 * null, and so is every later step. `materialise` turns a plan into rows.
 */
export type ComplaintPlan = {
  id: string;
  flatKey: string;
  raisedByUserKey: string;
  body: string;
  categoryCode: string;
  urgency: ComplaintUrgency;
  safety: boolean;
  assigneeUserKey: string;
  createdAt: number;
  classification: {
    source: ClassificationSource;
    confidence: number | null;
    at: number;
    /** For MANUAL: the category the complaint had before staff corrected it. */
    correctedFromCategoryCode: string | null;
  };
  escalatedAt: number | null;
  assignedAt: number | null;
  firstResponseAt: number | null;
  comments: { at: number; body: string }[];
  resolvedAt: number | null;
  closedAt: number | null;
  closeKind: CloseKind | null;
  rating: number | null;
  reopen: ReopenPlan | null;
  /** DUPLICATE_LINKED and AFFECTED_TOO events, which belong to the duplicate-cluster data. */
  extraEvents: { type: "DUPLICATE_LINKED" | "AFFECTED_TOO"; at: number; payload: Record<string, string | number | null> }[];
};
