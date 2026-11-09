import { roleTitleKey } from "@/domain/auth/role-title";
import { t } from "@/lib/messages";

/** The heading of the staff home for a list of permissions, from the message catalog (D186). */
export function roleTitle(permissions: readonly string[]): string {
  switch (roleTitleKey(permissions)) {
    case "DUTY_MANAGER":
      return t("staff.role.dutyManager");
    case "COMPLAINTS_MANAGER":
      return t("staff.role.complaintsManager");
    case "ACCOUNTANT_APPROVER":
      return t("staff.role.accountantApprover");
    case "APPROVER":
      return t("staff.role.approver");
    case "ACCOUNTANT":
      return t("staff.role.accountant");
    case "COMMITTEE":
      return t("staff.role.committee");
    case "STAFF":
      return t("staff.role.staff");
  }
}

/** The message for a staff permission. A permission this app does not know is shown as it is stored. */
export function permissionLabel(permission: string): string {
  switch (permission) {
    case "payments:match":
      return t("permission.paymentsMatch");
    case "payments:approve":
      return t("permission.paymentsApprove");
    case "reports:view":
      return t("permission.reportsView");
    case "complaints:manage":
      return t("permission.complaintsManage");
    case "complaints:duty_manager":
      return t("permission.complaintsDutyManager");
    default:
      return permission;
  }
}

/** The most rows a tool section of the staff home lists. */
export const NEXT_UP_MAX = 3;

/** The "See all" row of a tool section: shown only when more rows exist than the three listed (D237). */
export type SeeAll = { href: string; label: string };
