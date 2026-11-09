import Link from "next/link";
import { DemoNoteLine } from "@/components/demo-note";
import { EmergencyButton } from "@/components/emergency-sheet";
import { ComplaintStatusMark, ComplaintTracker, complaintSteps } from "@/components/complaint-progress";
import { Money } from "@/components/ui/money";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusTag } from "@/components/ui/status-tag";
import { stepNumber } from "@/components/ui/tracker";
import { DoubleRule, Hairline } from "@/components/ui/rules";
import { formatRupees } from "@/domain/money/money";
import type { DemoNoteState } from "@/lib/demo-note";
import { formatDay } from "@/lib/format-date";
import { complaintStepLine, dueTag, entryLabel, otherComplaintsText, partlyPaidText } from "@/lib/home-text";
import { t } from "@/lib/messages";
import type { FlatRelation, HomeComplaint, HomeData, RecentEntry } from "@/server/home/types";
import { DuesActions } from "./dues-sheet";
import { OfflineBanner } from "./offline-banner";
import { SafetyAlert } from "./safety-alert";

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

function DuesCard({ data }: { data: Ok }) {
  const { dues, asOf } = data;
  const tag = dueTag(dues);
  const open = dues.openBills.length > 0;
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
        <DuesActions dues={dues} asOf={asOf} flatCode={data.flat.code} bankAccount={data.bankAccount} payOutlined={data.safetyAlert !== null} />
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

function ComplaintCard({ complaint, others }: { complaint: HomeComplaint; others: number }) {
  const steps = complaintSteps(complaint.current);
  return (
    <div className="flex flex-col gap-3">
      <Link href={`/complaints/${complaint.id}`} className="flex min-h-12 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words text-body font-semibold">{complaint.title}</p>
          <ComplaintStatusMark current={complaint.current} label={steps[complaint.current].label} />
        </div>
        <ComplaintTracker current={complaint.current} />
        <p className="tnum text-body">{complaintStepLine(stepNumber(steps), steps.length, complaint.reply)}</p>
      </Link>
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
 * newest open complaint with its tracker, and the last two ledger
 * lines. It draws data and decides nothing about money: the Pay button's amount comes from the dues, and tapping it asks
 * the server to lock the amount. While the flat has an open safety complaint, the safety alert sits above the dues and Pay is outlined (D126).
 * The complaint card opens the complaint; "Raise a complaint" opens the form. No View ledger, no Receipt: those arrive with their features.
 */
export function HomeView({ data, demoNote = null }: { data: HomeData; demoNote?: DemoNoteState | null }) {
  if (data.kind === "NO_FLAT") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-heading font-semibold">{t("home.welcome", { name: data.userName })}</h1>
        <p className="text-body">{t("home.noFlat")}</p>
      </main>
    );
  }
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

      <OfflineBanner />
      {data.safetyAlert !== null && <SafetyAlert alert={data.safetyAlert} />}

      {data.paymentNotice === "LAST_FAILED" && <Notice>{t("pay.failedStrip")}</Notice>}

      <DuesCard data={data} />

      <section className="flex flex-col gap-3">
        <SectionHeader title={t("complaints.title")} action={{ label: t("complaints.raise"), href: "/complaints/new" }} />
        <Hairline />
        {data.complaint === null ? <p className="text-body text-ink-2">{t("complaint.none")}</p> : <ComplaintCard complaint={data.complaint} others={data.otherOpenComplaints} />}
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

      {demoNote !== null && <DemoNoteLine note={demoNote} />}
    </main>
  );
}
