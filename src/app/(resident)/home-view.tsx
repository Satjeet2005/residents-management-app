import { EmergencyButton } from "@/components/emergency-sheet";
import { CheckIcon } from "@/components/icons";
import { Money } from "@/components/ui/money";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusTag } from "@/components/ui/status-tag";
import { Tracker, stepNumber, type TrackerStep } from "@/components/ui/tracker";
import { DoubleRule, Hairline } from "@/components/ui/rules";
import { COMPLAINT_STEP_KEYS } from "@/domain/complaints/step";
import { formatRupees } from "@/domain/money/money";
import { formatDay } from "@/lib/format-date";
import { complaintStepLine, dueTag, entryLabel, otherComplaintsText, partlyPaidText, visitorTimesText, visitorsText } from "@/lib/home-text";
import { t } from "@/lib/messages";
import type { FlatRelation, HomeComplaint, HomeData, RecentEntry } from "@/server/home/types";
import { DuesActions } from "./dues-sheet";

type Ok = Extract<HomeData, { kind: "OK" }>;

function relationText(relation: FlatRelation): string {
  switch (relation) {
    case "OWNER":
      return t("relation.owner");
    case "TENANT":
      return t("relation.tenant");
    case "FAMILY":
      return t("relation.family");
  }
}

function stepLabel(key: (typeof COMPLAINT_STEP_KEYS)[number]): string {
  switch (key) {
    case "complaint.step.raised":
      return t("complaint.step.raised");
    case "complaint.step.assigned":
      return t("complaint.step.assigned");
    case "complaint.step.inProgress":
      return t("complaint.step.inProgress");
    case "complaint.step.resolved":
      return t("complaint.step.resolved");
  }
}

function DuesCard({ data }: { data: Ok }) {
  const { dues, asOf } = data;
  const tag = dueTag(dues);
  const open = dues.status === "OVERDUE" || dues.status === "NOT_YET_DUE" || dues.status === "PARTLY_PAID";
  if (open) {
    return (
      <section aria-label={t("dues.title")} className="flex flex-col gap-3">
        <p className="tnum text-caption text-ink-2">{t("dues.label", { date: formatDay(asOf) })}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Money amount={dues.amountDuePaise} size="hero" />
          {tag !== null && <StatusTag tone={tag.tone}>{tag.text}</StatusTag>}
        </div>
        <DoubleRule />
        {dues.partlyPaid !== null && <p className="tnum text-body">{partlyPaidText(dues.partlyPaid)}</p>}
        <DuesActions dues={dues} asOf={asOf} flatCode={data.flat.code} bankAccount={data.bankAccount} />
      </section>
    );
  }
  if (dues.status === "CREDIT") {
    return (
      <section aria-label={t("dues.title")} className="flex flex-col gap-3">
        <p className="tnum text-heading font-semibold">{t("dues.credit", { amount: formatRupees(dues.creditPaise) })}</p>
        <DoubleRule />
        <p className="text-body">{t("dues.creditNote")}</p>
      </section>
    );
  }
  return (
    <section aria-label={t("dues.title")} className="flex flex-col gap-3">
      <p className="text-heading font-semibold">{t("dues.none")}</p>
      <DoubleRule />
      {dues.lastPayment !== null && <p className="tnum text-body">{t("dues.lastPayment", { amount: formatRupees(dues.lastPayment.amountPaise), date: formatDay(dues.lastPayment.date) })}</p>}
    </section>
  );
}

/** The status of a complaint at the right of its title: a small mark and the word of the current step. */
function ComplaintStatus({ current, label }: { current: number; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-body font-semibold">
      {current === COMPLAINT_STEP_KEYS.length - 1 ? <CheckIcon size={20} /> : <span aria-hidden="true" className="h-4 w-4 rounded-full border-[5px] border-accent" />}
      {label}
    </span>
  );
}

function ComplaintCard({ complaint, others }: { complaint: HomeComplaint; others: number }) {
  const steps: TrackerStep[] = COMPLAINT_STEP_KEYS.map((key, index) => ({ label: stepLabel(key), state: index < complaint.current ? "done" : index === complaint.current ? "current" : "upcoming" }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-body font-semibold">{complaint.title}</p>
        <ComplaintStatus current={complaint.current} label={steps[complaint.current].label} />
      </div>
      <Tracker steps={steps} label={t("complaint.progress")} showStepText={false} />
      <p className="tnum text-body">{complaintStepLine(stepNumber(steps), steps.length, complaint.reply)}</p>
      {others > 0 && <p className="text-body text-ink-2">{otherComplaintsText(others)}</p>}
    </div>
  );
}

/** One row of Recent activity: the date at the left, the particulars, the amount right-aligned in semibold, a hairline under it. */
function ActivityRow({ entry }: { entry: RecentEntry }) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-x-3 border-b border-hairline py-3 text-body">
      <span className="tnum">{formatDay(entry.date)}</span>
      <span className="min-w-0 break-words">{entryLabel(entry.entryType)}</span>
      <Money amount={entry.amountPaise} size="strong" />
    </li>
  );
}

/**
 * The resident Home for one set of data (D23): the flat and who is signed in, the dues card with the breakdown sheet, the
 * newest open complaint with its tracker, a summary of today's visitors (times only, no names), and the last two ledger
 * lines. It draws data and decides nothing about money: the Pay button's amount comes from the dues, and tapping it asks
 * the server to lock the amount. No View ledger, no Receipt, no complaint buttons: those arrive with their features.
 */
export function HomeView({ data }: { data: HomeData }) {
  if (data.kind === "NO_FLAT") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-heading font-semibold">{t("home.welcome", { name: data.userName })}</h1>
        <p className="text-body">{t("home.noFlat")}</p>
      </main>
    );
  }
  const times = visitorTimesText(data.visitors.map((visitor) => visitor.expectedAt));
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="tnum text-heading font-semibold">{data.flat.code}</h1>
          <p className="text-body text-ink-2">{t("home.who", { name: data.userName, relation: relationText(data.flat.relation) })}</p>
          {data.moreThanOneFlat && <p className="text-caption text-ink-2">{t("home.showing", { code: data.flat.code })}</p>}
        </div>
        <EmergencyButton numbers={data.emergency} />
      </header>

      {data.paymentNotice === "LAST_FAILED" && <Notice>{t("pay.failedStrip")}</Notice>}

      <DuesCard data={data} />

      <section className="flex flex-col gap-3">
        <SectionHeader title={t("complaints.title")} />
        <Hairline />
        {data.complaint === null ? <p className="text-body text-ink-2">{t("complaint.none")}</p> : <ComplaintCard complaint={data.complaint} others={data.otherOpenComplaints} />}
      </section>

      <section aria-label={t("visitors.title")}>
        <Hairline />
        <div className="py-3">
          <p className="text-body font-semibold">{visitorsText(data.visitors.length)}</p>
          {times !== null && <p className="tnum text-body">{times}</p>}
        </div>
        <Hairline />
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t("recent.title")} />
        {data.recent.length === 0 ? (
          <p className="text-body text-ink-2">{t("recent.none")}</p>
        ) : (
          <ul className="border-t border-hairline">
            {data.recent.map((entry, index) => (
              <ActivityRow key={`${entry.date}-${index}`} entry={entry} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
