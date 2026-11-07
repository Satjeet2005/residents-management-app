import { defaultLateFeePolicy } from "../billing/late-fee";
import {
  type ComplaintUrgency,
  DEMO_AS_OF,
  type DemoComplaintCategory,
  type DemoSetting,
  type DemoUser,
} from "./types";

export const COMPLAINT_ASSIGNEE_NAME = "Kavita Rao";
export const DUTY_MANAGER_NAME = "Sanjay Pawar";
export const ACCOUNTS_STAFF_NAME = "Priya Nair";

/** Minutes from a complaint's creation to the due time of its first response. */
export const SLA_MINUTES: Readonly<Record<ComplaintUrgency, number>> = { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 };

/**
 * Fictional staff phones. They start with 5 like every demo phone, and are
 * above the range the demo users count up through (5000000001 onwards).
 */
export const DUTY_MANAGER_PHONE = "5900000001";
export const ACCOUNTS_PHONE = "5900000002";

/**
 * D116: the DEMO's second-approver threshold is ₹10,000 (a labelled assumption), so the approval path can be shown with a manual match
 * on the demo's own amounts. The matcher's built-in default (`defaultMatchSettings`, ₹25,000) and the benchmark are unchanged.
 */
export const APPROVAL_THRESHOLD_PAISE = 1_000_000;

const CATEGORIES: readonly { code: string; name: string }[] = [
  { code: "PLUMBING", name: "Plumbing" },
  { code: "ELECTRICAL", name: "Electrical" },
  { code: "HOUSEKEEPING", name: "Housekeeping" },
  { code: "LIFT", name: "Lift" },
  { code: "OTHER", name: "Other" },
];

export function userKeyByName(users: readonly DemoUser[], name: string): string {
  const user = users.find((u) => u.name === name);
  if (user === undefined) throw new RangeError(`Demo user "${name}" does not exist`);
  return user.key;
}

export function buildCategories(users: readonly DemoUser[]): DemoComplaintCategory[] {
  const defaultAssigneeUserKey = userKeyByName(users, COMPLAINT_ASSIGNEE_NAME);
  return CATEGORIES.map(({ code, name }) => ({ key: `category:${code}`, code, name, defaultAssigneeUserKey }));
}

/** Who a complaint goes to: safety complaints always go to the duty manager, others to the category's default assignee. */
export function assigneeFor(category: DemoComplaintCategory, safety: boolean, dutyManagerUserKey: string): string {
  return safety ? dutyManagerUserKey : category.defaultAssigneeUserKey;
}

/** The committee report's targets (R67, ASSUMPTIONS): 90 percent of bills paid on time, 90 percent of complaints replied to within the SLA, at most 8 percent of resolved complaints reopened. */
export const COMMITTEE_GOALS = { onTimeCollectionPercent: 90, firstReplyWithinSlaPercent: 90, reopenedPercentMax: 8 } as const;

export function buildSettings(): DemoSetting[] {
  return [
    { key: "late_fee_policy", value: { ...defaultLateFeePolicy } },
    { key: "approval_threshold_paise", value: APPROVAL_THRESHOLD_PAISE },
    { key: "sla_minutes", value: { ...SLA_MINUTES } },
    { key: "escalation_hours", value: 24 },
    { key: "safety_ack_timeout_minutes", value: 5 },
    { key: "auto_close_days", value: 7 },
    { key: "duty_manager_phone", value: DUTY_MANAGER_PHONE },
    { key: "accounts_phone", value: ACCOUNTS_PHONE },
    { key: "emergency_services_phone", value: null },
    { key: "society_bank_account", value: { name: "Sample Society Maintenance Account", number: "000000000000", ifsc: "SAMP0000000" } },
    { key: "demo_as_of", value: DEMO_AS_OF },
    { key: "committee_goals", value: { ...COMMITTEE_GOALS } },
  ];
}
