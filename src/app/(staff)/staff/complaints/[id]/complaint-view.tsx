import Link from "next/link";
import { StatusTag } from "@/components/ui/status-tag";
import { t } from "@/lib/messages";
import { categoryLabel, confidenceWords, sourceName, sourceTag, staffStatusLabel, urgencyLabel, urgencyTone } from "@/lib/staff-complaints/labels";
import { slaWords, whenWords } from "@/lib/staff-complaints/time";
import { complaintTitle } from "@/server/home/mapper";
import type { ComplaintPage } from "@/server/complaints/staff-page-data";
import { controlsFor } from "@/lib/staff-complaints/controls";
import { ActionPanel } from "./action-panel";
import { TimelineList } from "./timeline-list";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="break-words text-body">{children}</dd>
    </div>
  );
}

function Facts({ page }: { page: ComplaintPage }) {
  const { complaint } = page;
  const review = sourceTag({ source: null, needsReview: complaint.needsReview });
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Fact label={t("staffComplaints.fact.flat")}>
        <span className="tnum">{complaint.flatCode}</span>
      </Fact>
      <Fact label={t("staffComplaints.fact.raisedBy")}>{complaint.raisedBy}</Fact>
      <Fact label={t("staffComplaints.fact.raisedAt")}>
        <span className="tnum">{whenWords(complaint.createdAt)}</span>
      </Fact>
      <Fact label={t("staffComplaints.fact.status")}>{staffStatusLabel(complaint.status)}</Fact>
      <Fact label={t("staffComplaints.fact.category")}>
        <span className="flex flex-wrap items-center gap-2">
          {categoryLabel(complaint.category)}
          {review !== null && <StatusTag tone={review.tone}>{review.text}</StatusTag>}
        </span>
      </Fact>
      <Fact label={t("staffComplaints.fact.urgency")}>
        <StatusTag tone={urgencyTone(complaint.urgency)}>{urgencyLabel(complaint.urgency)}</StatusTag>
      </Fact>
      <Fact label={t("staffComplaints.fact.assignee")}>{complaint.assignee?.name ?? t("staffComplaints.unassigned")}</Fact>
    </dl>
  );
}

function SafetyLine({ page }: { page: ComplaintPage }) {
  if (!page.complaint.safety) return null;
  return (
    <div className="flex flex-col gap-1 rounded-control border-2 border-caution p-4">
      <p className="text-body font-semibold text-caution">{t("staffComplaints.safety.title")}</p>
      <p className="text-body">{page.acknowledgedAt === null ? t("staffComplaints.safety.notSeen") : t("staffComplaints.safety.seen", { when: whenWords(page.acknowledgedAt) })}</p>
    </div>
  );
}

function Classifications({ page }: { page: ComplaintPage }) {
  return (
    <section aria-labelledby="classification-heading" className="flex flex-col gap-2">
      <h2 id="classification-heading" className="text-title font-semibold">
        {t("staffComplaints.classification.heading")}
      </h2>
      {page.classifications.length === 0 ? (
        <p className="text-body text-ink-2">{t("staffComplaints.classification.none")}</p>
      ) : (
        <ul className="border-t border-hairline">
          {page.classifications.map((line, index) => (
            <li key={`${line.at}-${index}`} className="flex flex-col gap-1 border-b border-hairline py-3 text-body">
              <span className="tnum text-ink-2">{whenWords(line.at)}</span>
              <span className="break-words">
                {t("staffComplaints.classification.line", { source: sourceName(line.source), category: categoryLabel(line.category), urgency: urgencyLabel(line.urgency), confidence: confidenceWords(line.confidence) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Clocks({ page }: { page: ComplaintPage }) {
  const { complaint, now, sla } = page;
  return (
    <section aria-labelledby="clock-heading" className="flex flex-col gap-2">
      <h2 id="clock-heading" className="text-title font-semibold">
        {t("staffComplaints.clock.heading")}
      </h2>
      <ul className="flex flex-col gap-1 text-body">
        <li className="font-semibold">{slaWords({ sla, responseDueAt: complaint.responseDueAt, now })}</li>
        {complaint.responseDueAt !== null && <li className="tnum">{t("staffComplaints.clock.due", { when: whenWords(complaint.responseDueAt) })}</li>}
        <li className="tnum">{complaint.firstResponseAt === null ? t("staffComplaints.clock.noReply") : t("staffComplaints.clock.firstReply", { when: whenWords(complaint.firstResponseAt) })}</li>
        {complaint.pendingConfirmationAt !== null && <li className="tnum">{t("staffComplaints.clock.resolved", { when: whenWords(complaint.pendingConfirmationAt) })}</li>}
        {complaint.closedAt !== null && <li className="tnum">{t("staffComplaints.clock.closed", { when: whenWords(complaint.closedAt) })}</li>}
        {complaint.reopenCount > 0 && <li>{complaint.reopenCount === 1 ? t("staffComplaints.clock.reopenedOnce") : t("staffComplaints.clock.reopenedMany", { n: complaint.reopenCount })}</li>}
      </ul>
    </section>
  );
}

/**
 * One complaint for staff: the full text, the flat, who raised it, how it was classified, the reply clocks and the FULL timeline, internal events and
 * comments included and marked, and the action panel (on the right from 1024px, below the timeline on a narrow screen). One h1 (the title).
 */
export function ComplaintView({ page }: { page: ComplaintPage }) {
  const { complaint } = page;
  const controls = controlsFor({ status: complaint.status, safety: complaint.safety, acknowledged: page.acknowledgedAt !== null, viewer: page.viewer });
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <Link href="/staff/complaints" className="inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4">
          {t("staffComplaints.back")}
        </Link>
        <h1 className="break-words text-heading font-semibold">{complaintTitle(complaint.body)}</h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <SafetyLine page={page} />
          <section aria-labelledby="text-heading" className="flex flex-col gap-2">
            <h2 id="text-heading" className="text-title font-semibold">
              {t("staffComplaints.detail.text")}
            </h2>
            <p className="whitespace-pre-line break-words text-body">{complaint.body}</p>
          </section>
          <section aria-labelledby="facts-heading" className="flex flex-col gap-2">
            <h2 id="facts-heading" className="text-title font-semibold">
              {t("staffComplaints.detail.facts")}
            </h2>
            <Facts page={page} />
          </section>
          <Clocks page={page} />
          <Classifications page={page} />
          <section aria-labelledby="timeline-heading" className="flex flex-col gap-2">
            <h2 id="timeline-heading" className="text-title font-semibold">
              {t("staffComplaints.timeline.heading")}
            </h2>
            <TimelineList lines={page.timeline} />
          </section>
        </div>
        <aside aria-labelledby="panel-heading" className="flex flex-col gap-3 lg:sticky lg:top-4">
          <h2 id="panel-heading" className="text-title font-semibold">
            {t("staffComplaints.panel.heading")}
          </h2>
          <ActionPanel
            id={complaint.id}
            version={complaint.version}
            controls={controls}
            staffUsers={page.staffUsers}
            currentCategory={complaint.category}
            needsReview={complaint.needsReview}
          />
        </aside>
      </div>
    </main>
  );
}
