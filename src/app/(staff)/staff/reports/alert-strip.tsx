import Link from "next/link";
import { WarningIcon } from "@/components/icons";
import { t } from "@/lib/messages";

/**
 * The strip at the very top of the report, only when a safety complaint is waiting for the duty manager (the acknowledgement fact, any month). The sentence links
 * to the safety view of the complaints board ONLY for a viewer who may manage complaints; for anyone else it is plain text (the link would send them away).
 */
export function AlertStrip({ count, canManageComplaints }: { count: number; canManageComplaints: boolean }) {
  if (count === 0) return null;
  const sentence = count === 1 ? t("committee.complaints.safety.warnOne") : t("committee.complaints.safety.warnMany", { n: count });
  return (
    <div role="status" className="flex items-center gap-3 rounded-control border-2 border-caution bg-paper p-3 text-body font-semibold text-caution">
      <WarningIcon size={24} />
      {canManageComplaints ? (
        <Link href="/staff/complaints?view=safety" className="inline-flex min-h-12 items-center underline underline-offset-4">
          {sentence}
        </Link>
      ) : (
        <span>{sentence}</span>
      )}
    </div>
  );
}
