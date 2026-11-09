import Link from "next/link";
import { WarningIcon } from "@/components/icons";
import { StatusTag } from "@/components/ui/status-tag";
import { t } from "@/lib/messages";
import { type DetailTab, classificationOneLine, trimTimeline } from "@/lib/staff-complaints/detail";
import { categoryLabel, confidenceWords, sourceName, sourceTag, staffStatusLabel, urgencyLabel, urgencyTone } from "@/lib/staff-complaints/labels";
import { replyChipWords, whenWords } from "@/lib/staff-complaints/time";
import { controlsFor } from "@/lib/staff-complaints/controls";
import { barKind } from "@/lib/staff-complaints/primary-bar";
import { complaintTitle } from "@/server/home/mapper";
import type { ComplaintPage } from "@/server/complaints/staff-page-data";
import { ActionPanel } from "./action-panel";
import { ActionsBar } from "./actions-bar";
import { CategoryChips } from "./category-chips";
import { DetailTabs } from "./detail-tabs";
import { TimelineList } from "./timeline-list";

const flatChip = (code: string) => <span className="tnum inline-flex min-h-7 items-center rounded-control border border-control bg-paper-2 px-2 text-caption">{code}</span>;

function Fact({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 flex min-w-0 flex-col" : "flex min-w-0 flex-col"}>
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="break-words text-body">{children}</dd>
    </div>
  );
}

/** The seven facts in two columns, in the order of the task. */
function Facts({ page }: { page: ComplaintPage }) {
  const { complaint } = page;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      <Fact label={t("staffComplaints.fact.flat")}>
        <span className="tnum">{complaint.flatCode}</span>
      </Fact>
      <Fact label={t("staffComplaints.fact.raisedBy")}>{complaint.raisedBy}</Fact>
      <Fact label={t("staffComplaints.fact.raisedAt")}>
        <span className="tnum">{whenWords(complaint.createdAt)}</span>
      </Fact>
      {page.viewer.canManage ? (
        <Fact label={t("staffComplaints.fact.category")} wide>
          <CategoryChips id={complaint.id} version={complaint.version} category={complaint.category} closed={complaint.status === "CLOSED"} />
        </Fact>
      ) : (
        <Fact label={t("staffComplaints.fact.category")}>{categoryLabel(complaint.category)}</Fact>
      )}
      <Fact label={t("staffComplaints.fact.urgency")}>{urgencyLabel(complaint.urgency)}</Fact>
      <Fact label={t("staffComplaints.fact.assignee")}>{complaint.assignee?.name ?? t("staffComplaints.unassigned")}</Fact>
      <Fact label={t("staffComplaints.fact.status")}>{staffStatusLabel(complaint.status)}</Fact>
    </dl>
  );
}

/** One line for a safety complaint: the duty manager has not seen it, or when it was seen. */
function SafetyLine({ page }: { page: ComplaintPage }) {
  if (!page.complaint.safety) return null;
  return (
    <p className="flex min-h-12 items-center gap-2 rounded-control border-2 border-caution px-3 py-2 text-body font-semibold text-caution">
      <WarningIcon />
      {page.acknowledgedAt === null ? t("staffComplaints.safety.notSeen") : t("staffComplaints.safety.seen", { when: whenWords(page.acknowledgedAt) })}
    </p>
  );
}

/** How it was classified in ONE line, and a "Why?" expander with the history (source, category, urgency, confidence of each classification, newest first). */
function Classification({ page }: { page: ComplaintPage }) {
  const review = sourceTag({ source: null, needsReview: page.complaint.needsReview });
  const line = classificationOneLine(page.classifications[0]);
  return (
    <section aria-labelledby="classification-heading" className="flex flex-col gap-2">
      <h2 id="classification-heading" className="text-title font-semibold">
        {t("staffComplaints.classification.heading")}
      </h2>
      <p className="flex flex-wrap items-center gap-2 text-body">
        {line ?? t("staffComplaints.classification.none")}
        {review !== null && <StatusTag tone={review.tone}>{review.text}</StatusTag>}
      </p>
      {page.classifications.length > 0 && (
        <details>
          <summary className="inline-flex min-h-12 min-w-12 cursor-pointer items-center text-body font-semibold text-accent underline underline-offset-4">{t("staffComplaints.classification.why")}</summary>
          <ul className="border-t border-hairline">
            {page.classifications.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex flex-col gap-1 border-b border-hairline py-2 text-body">
                <span className="tnum text-caption text-ink-2">{whenWords(entry.at)}</span>
                <span className="break-words">
                  {t("staffComplaints.classification.line", { source: sourceName(entry.source), category: categoryLabel(entry.category), urgency: urgencyLabel(entry.urgency), confidence: confidenceWords(entry.confidence) })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The reply clock on one line: the state in words and the due time. The first reply, the resolution, the closing and the reopenings are lines of the timeline. */
function ReplyClock({ page }: { page: ComplaintPage }) {
  const { complaint, now, sla } = page;
  const state = replyChipWords({ sla, responseDueAt: complaint.responseDueAt, now });
  return (
    <section aria-labelledby="clock-heading" className="flex flex-col gap-1">
      <h2 id="clock-heading" className="text-title font-semibold">
        {t("staffComplaints.clock.heading")}
      </h2>
      <p className="tnum text-body">{complaint.responseDueAt === null ? state : t("staffComplaints.clock.line", { state, when: whenWords(complaint.responseDueAt) })}</p>
      <ul className="flex flex-col text-caption text-ink-2">
        <li>{complaint.firstResponseAt === null ? t("staffComplaints.clock.noReply") : t("staffComplaints.clock.firstReply", { when: whenWords(complaint.firstResponseAt) })}</li>
        {complaint.pendingConfirmationAt !== null && <li>{t("staffComplaints.clock.resolved", { when: whenWords(complaint.pendingConfirmationAt) })}</li>}
        {complaint.closedAt !== null && <li>{t("staffComplaints.clock.closed", { when: whenWords(complaint.closedAt) })}</li>}
        {complaint.reopenCount > 0 && <li>{complaint.reopenCount === 1 ? t("staffComplaints.clock.reopenedOnce") : t("staffComplaints.clock.reopenedMany", { n: complaint.reopenCount })}</li>}
      </ul>
    </section>
  );
}

function DetailsPanel({ page }: { page: ComplaintPage }) {
  return (
    <>
      <section aria-labelledby="text-heading" className="flex flex-col gap-2">
        <h2 id="text-heading" className="text-title font-semibold">
          {t("staffComplaints.detail.text")}
        </h2>
        <p className="whitespace-pre-line break-words text-body">{page.complaint.body}</p>
      </section>
      <Facts page={page} />
      <ReplyClock page={page} />
      <Classification page={page} />
    </>
  );
}

/** The latest three events, and the earlier ones behind a "Show all (n)" expander (a <details>, so it needs no script). */
function TimelinePanel({ page }: { page: ComplaintPage }) {
  const { recent, earlier } = trimTimeline(page.timeline);
  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-2">
      <h2 id="timeline-heading" className="text-title font-semibold">
        {t("staffComplaints.timeline.heading")}
      </h2>
      <TimelineList lines={recent} />
      {earlier.length > 0 && (
        <details>
          <summary className="inline-flex min-h-12 min-w-12 cursor-pointer items-center text-body font-semibold text-accent underline underline-offset-4">{t("staffComplaints.timeline.showAll", { n: page.timeline.length })}</summary>
          <TimelineList lines={earlier} />
        </details>
      )}
    </section>
  );
}

/**
 * One complaint for staff (D152): a header with the title (two lines at most) and the chips for the flat, the urgency, the status and the reply clock; for a safety
 * complaint a one-line banner; the Details and Timeline tabs; and the actions: the panel on the right from 1024px, and below 1024px a pinned bar with an actions sheet. One h1 (the title).
 */
export function ComplaintView({ page, tab }: { page: ComplaintPage; tab: DetailTab }) {
  const { complaint } = page;
  const controls = controlsFor({ status: complaint.status, safety: complaint.safety, acknowledged: page.acknowledgedAt !== null, viewer: page.viewer });
  const bar = barKind({ status: complaint.status, safety: complaint.safety, acknowledged: page.acknowledgedAt !== null, viewer: page.viewer });
  const lateTone = page.sla === "OVERDUE" || page.sla === "LATE";
  return (
    <main className={bar === "NONE" ? "mx-auto flex w-full max-w-7xl flex-col gap-4 p-4" : "mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 pb-28 lg:pb-4"}>
      <header className="flex flex-col gap-2">
        <Link href="/staff/complaints" className="inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4">
          {t("staffComplaints.back")}
        </Link>
        <h1 className="max-h-[72px] overflow-hidden break-words text-heading font-semibold">{complaintTitle(complaint.body)}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {flatChip(complaint.flatCode)}
          <StatusTag tone={urgencyTone(complaint.urgency)}>{urgencyLabel(complaint.urgency)}</StatusTag>
          <StatusTag>{staffStatusLabel(complaint.status)}</StatusTag>
          <StatusTag tone={lateTone ? "caution" : "neutral"}>{replyChipWords({ sla: page.sla, responseDueAt: complaint.responseDueAt, now: page.now })}</StatusTag>
        </div>
      </header>
      <SafetyLine page={page} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <DetailTabs initial={tab} details={<DetailsPanel page={page} />} timeline={<TimelinePanel page={page} />} />
        <aside aria-labelledby="panel-heading" className="hidden flex-col gap-3 lg:sticky lg:top-4 lg:flex">
          <h2 id="panel-heading" className="text-title font-semibold">
            {t("staffComplaints.panel.heading")}
          </h2>
          <ActionPanel id={complaint.id} version={complaint.version} controls={controls} staffUsers={page.staffUsers} />
        </aside>
      </div>
      {bar !== "NONE" && <ActionsBar id={complaint.id} version={complaint.version} kind={bar} controls={controls} staffUsers={page.staffUsers} />}
    </main>
  );
}
