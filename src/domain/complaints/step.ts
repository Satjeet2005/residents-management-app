export type ComplaintStatus = "NEW" | "ASSIGNED" | "IN_PROGRESS" | "PENDING_CONFIRMATION" | "CLOSED" | "REOPENED";

/** The four steps a resident sees, as message keys (the words come from the catalog). */
export const COMPLAINT_STEP_KEYS = ["complaint.step.raised", "complaint.step.assigned", "complaint.step.inProgress", "complaint.step.resolved"] as const;

export type ComplaintStep = {
  steps: typeof COMPLAINT_STEP_KEYS;
  /** The index of the current step, 0 to 3. */
  current: 0 | 1 | 2 | 3;
  /** True when the society has said it is fixed and is waiting for the resident to confirm or reopen. */
  needsAnswer: boolean;
};

const CURRENT: Record<ComplaintStatus, ComplaintStep["current"]> = {
  NEW: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  PENDING_CONFIRMATION: 3,
  // A reopened complaint goes back to the assigned step; a closed one is past the last step.
  REOPENED: 1,
  CLOSED: 3,
};

/** Where a complaint is in the four steps (Raised, Assigned, In progress, Resolved). */
export function complaintStep(status: ComplaintStatus): ComplaintStep {
  return { steps: COMPLAINT_STEP_KEYS, current: CURRENT[status], needsAnswer: status === "PENDING_CONFIRMATION" };
}
