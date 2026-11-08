export type RoleTitleKey = "DUTY_MANAGER" | "COMPLAINTS_MANAGER" | "ACCOUNTANT_APPROVER" | "APPROVER" | "ACCOUNTANT" | "COMMITTEE" | "STAFF";

/**
 * The title shown at the top of the staff home (D186). The data model has no job titles, so a title is worked out from what a person may do, first match wins:
 * the duty manager, a complaints manager, an accountant who also approves, an approver, an accountant, a committee member, plain staff. Anything that is not a
 * permission this app knows is ignored.
 */
export function roleTitleKey(permissions: readonly string[]): RoleTitleKey {
  const has = (permission: string): boolean => permissions.includes(permission);
  if (has("complaints:duty_manager")) return "DUTY_MANAGER";
  if (has("complaints:manage")) return "COMPLAINTS_MANAGER";
  if (has("payments:match") && has("payments:approve")) return "ACCOUNTANT_APPROVER";
  if (has("payments:approve")) return "APPROVER";
  if (has("payments:match")) return "ACCOUNTANT";
  if (has("reports:view")) return "COMMITTEE";
  return "STAFF";
}
