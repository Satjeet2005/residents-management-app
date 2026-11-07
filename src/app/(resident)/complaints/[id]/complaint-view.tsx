import { ComplaintTracker, complaintSteps } from "@/components/complaint-progress";
import { CheckIcon } from "@/components/icons";
import { Notice } from "@/components/ui/notice";
import { StatusTag, type StatusTone } from "@/components/ui/status-tag";
import { stepNumber } from "@/components/ui/tracker";
import { istDateOf } from "@/domain/time/calendar";
import { complaintStatusLabel } from "@/lib/complaint-text";
import { formatDay } from "@/lib/format-date";
import { complaintStepLine } from "@/lib/home-text";
import { t } from "@/lib/messages";
import type { ComplaintDetailData } from "@/server/complaints/page-data";
import { ComplaintActions } from "./complaint-actions";

type Ok = Extract<ComplaintDetailData, { kind: "OK" }>;

const toneOf = (status: Ok["complaint"]["status"]): StatusTone => (status === "CLOSED" ? "positive" : status === "REOPENED" ? "caution" : "neutral");

function closedLine(complaint: Ok["complaint"]): string {
  switch (complaint.closeKind) {
    case "CONFIRMED":
      return t("complaintDetail.closed.confirmed");
    case "AUTO_CLOSED":
      return t("complaintDetail.closed.auto");
    case "DUTY_MANAGER":
      return t("complaintDetail.closed.duty");
    case null:
      return t("complaint.status.closed");
  }
}

/** What the resident may do now, by state (design 4a to 4d). Read-only text where there is nothing to do. */
function Actions({ data }: { data: Ok }) {
  const { complaint, autoCloseDays } = data;
  const pending = complaint.status === "PENDING_CONFIRMATION";
  if (complaint.status === "CLOSED") {
    const canDispute = complaint.safety && complaint.canReopen;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body font-semibold">{closedLine(complaint)}</p>
        {complaint.rating !== null && <p className="tnum text-body">{t("complaintDetail.rated", { n: complaint.rating })}</p>}
        {canDispute && <ComplaintActions id={complaint.id} safety pending={false} autoCloseDays={autoCloseDays} />}
      </div>
    );
  }
  if (complaint.status === "REOPENED") return <p className="text-body">{t("complaintDetail.reopened")}</p>;
  if (pending) return <ComplaintActions id={complaint.id} safety={complaint.safety} pending autoCloseDays={autoCloseDays} />;
  return null;
}

/**
 * One complaint of the resident's flat: title, status tag, the tracker, the reply-due line, what the resident may do, and the timeline the resident
 * may see. `sent` shows the confirmation banner after raising it. A safety complaint never shows "Yes, it's fixed" or the auto-close line (D39).
 */
export function ComplaintView({ data, sent }: { data: Ok; sent: boolean }) {
  const { complaint } = data;
  const closed = complaint.status === "CLOSED";
  const steps = complaintSteps(complaint.current);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      {sent && <Notice>{complaint.safety ? t("complaintDetail.sentSafety") : t("complaintDetail.sent")}</Notice>}
      <header className="flex flex-col gap-3">
        <h1 className="break-words text-heading font-semibold">{complaint.title}</h1>
        <div>
          <StatusTag tone={toneOf(complaint.status)} icon={closed || complaint.current === 3 ? <CheckIcon size={16} /> : undefined}>
            {complaintStatusLabel(complaint.status)}
          </StatusTag>
        </div>
        {complaint.body !== complaint.title && <p className="whitespace-pre-line break-words text-body">{complaint.body}</p>}
      </header>

      <section className="flex flex-col gap-3">
        <ComplaintTracker current={complaint.current} />
        {!closed && <p className="tnum text-body">{complaintStepLine(stepNumber(steps), steps.length, complaint.reply)}</p>}
      </section>

      <Actions data={data} />

      <section aria-label={t("complaintDetail.timeline")} className="flex flex-col gap-2">
        <h2 className="text-title font-semibold">{t("complaintDetail.timeline")}</h2>
        <ol className="border-t border-hairline">
          {complaint.timeline.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="grid grid-cols-[4.5rem_1fr] gap-x-3 border-b border-hairline py-3 text-body">
              <span className="tnum">{formatDay(istDateOf(entry.at))}</span>
              <span className="min-w-0 break-words">
                {entry.label}
                {entry.text !== null && <span className="block text-ink-2">{entry.text}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
