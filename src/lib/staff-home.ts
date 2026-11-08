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
