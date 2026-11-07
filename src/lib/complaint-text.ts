import type { ComplaintStatus } from "@/domain/complaints/step";
import { t } from "./messages";

/** The word of a complaint's status at the right of its title. PENDING_CONFIRMATION reads "Marked fixed": the society says it is done and waits for the resident. */
export function complaintStatusLabel(status: ComplaintStatus): string {
  switch (status) {
    case "NEW":
      return t("complaint.status.new");
    case "ASSIGNED":
      return t("complaint.status.assigned");
    case "IN_PROGRESS":
      return t("complaint.status.inProgress");
    case "PENDING_CONFIRMATION":
      return t("complaint.status.markedFixed");
    case "REOPENED":
      return t("complaint.status.reopened");
    case "CLOSED":
      return t("complaint.status.closed");
  }
}
