import Link from "next/link";
import { ComplaintStatusMark, ComplaintTracker, complaintSteps } from "@/components/complaint-progress";
import { ButtonLink } from "@/components/ui/button-link";
import { stepNumber } from "@/components/ui/tracker";
import { complaintStatusLabel } from "@/lib/complaint-text";
import { complaintStepLine } from "@/lib/home-text";
import { t } from "@/lib/messages";
import type { OwnComplaintLine } from "@/server/complaints/read";
import type { ComplaintListData } from "@/server/complaints/page-data";

const CARD = "flex flex-col gap-3 rounded-control border border-hairline p-4";

/** An open complaint: title, status with its mark, the tracker, "Step n of 4" with the reply time. The whole card opens the complaint. */
function OpenCard({ complaint }: { complaint: OwnComplaintLine }) {
  return (
    <Link href={`/complaints/${complaint.id}`} className={`${CARD} min-h-12`}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-body font-semibold">{complaint.title}</p>
        <ComplaintStatusMark current={complaint.current} label={complaintStatusLabel(complaint.status)} />
      </div>
      <ComplaintTracker current={complaint.current} />
      <p className="tnum text-body">{complaintStepLine(stepNumber(complaintSteps(complaint.current)), 4, complaint.reply)}</p>
    </Link>
  );
}

function ClosedRow({ complaint }: { complaint: OwnComplaintLine }) {
  return (
    <li>
      <Link href={`/complaints/${complaint.id}`} className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline py-2">
        <span className="min-w-0 break-words text-body">{complaint.title}</span>
        <ComplaintStatusMark current={3} label={complaintStatusLabel(complaint.status)} />
      </Link>
    </li>
  );
}

/**
 * The complaints list (D15): the one filled control is "Raise a complaint"; open complaints come first; closed ones sit in a collapsed
 * "Closed (n)" section. With none open the page says so in words (the control above is the way to raise one).
 */
export function ComplaintsView({ data }: { data: ComplaintListData }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("complaints.title")}</h1>
      {data.kind === "NO_FLAT" ? (
        <p className="text-body">{t("complaints.noFlat")}</p>
      ) : (
        <>
          <ButtonLink href="/complaints/new">{t("complaints.raise")}</ButtonLink>
          {data.open.length === 0 ? (
            <p className="text-title font-semibold">{t("complaints.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.open.map((complaint) => (
                <li key={complaint.id}>
                  <OpenCard complaint={complaint} />
                </li>
              ))}
            </ul>
          )}
          {data.closed.length > 0 && (
            <details className="border-t border-hairline">
              <summary className="flex min-h-12 cursor-pointer items-center text-body font-semibold">{t("complaints.closed", { n: data.closed.length })}</summary>
              <ul>
                {data.closed.map((complaint) => (
                  <ClosedRow key={complaint.id} complaint={complaint} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </main>
  );
}
