import { EmergencyButton } from "@/components/emergency-sheet";
import { Money } from "@/components/ui/money";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusTag } from "@/components/ui/status-tag";
import { Tracker, type TrackerStep } from "@/components/ui/tracker";
import { LedgerLine } from "@/components/ui/ledger-line";
import { COMPLAINT_STEP_KEYS } from "@/domain/complaints/step";
import { formatRupees } from "@/domain/money/money";
import { formatDay, formatTimeIst } from "@/lib/format-date";
import { dueTag, entryLabel, otherComplaintsText, partlyPaidText, replyDueText, visitorsText } from "@/lib/home-text";
import { t } from "@/lib/messages";
import type { FlatRelation, HomeComplaint, HomeData } from "@/server/home/types";
import { DuesSheetButton } from "./dues-sheet";

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
  return (
    <section aria-labelledby="dues-heading" className="flex flex-col gap-3 rounded-control border border-hairline p-4">
      <h2 id="dues-heading" className="text-title font-semibold">
        {t("dues.title")}
      </h2>
      {open ? (
        <>
          <Money amount={dues.amountDuePaise} size="hero" />
          {tag !== null && <div><StatusTag tone={tag.tone}>{tag.text}</StatusTag></div>}
          {dues.partlyPaid !== null && <p className="tnum text-body">{partlyPaidText(dues.partlyPaid)}</p>}
        </>
      ) : dues.status === "CREDIT" ? (
        <p className="tnum text-heading font-semibold">{t("dues.credit", { amount: formatRupees(dues.creditPaise) })}</p>
      ) : (
        <>
          <p className="text-heading font-semibold">{t("dues.none")}</p>
          {dues.lastPayment !== null && <p className="tnum text-body text-ink-2">{t("dues.lastPayment", { amount: formatRupees(dues.lastPayment.amountPaise), date: formatDay(dues.lastPayment.date) })}</p>}
        </>
      )}
      <p className="tnum text-caption text-ink-2">{t("dues.asOf", { date: formatDay(asOf) })}</p>
      {open && <DuesSheetButton dues={dues} asOf={asOf} />}
    </section>
  );
}

function ComplaintCard({ complaint, others }: { complaint: HomeComplaint; others: number }) {
  const steps: TrackerStep[] = COMPLAINT_STEP_KEYS.map((key, index) => ({ label: stepLabel(key), state: index < complaint.current ? "done" : index === complaint.current ? "current" : "upcoming" }));
  return (
    <div className="flex flex-col gap-3 rounded-control border border-hairline p-4">
      <p className="text-body font-semibold">{complaint.title}</p>
      <Tracker steps={steps} label={t("complaint.progress")} />
      {complaint.reply !== null && <p className="tnum text-body">{replyDueText(complaint.reply)}</p>}
      {others > 0 && <p className="text-body text-ink-2">{otherComplaintsText(others)}</p>}
    </div>
  );
}

/**
 * The resident Home for one set of data (D23): the flat and who is signed in, the dues card with the breakdown sheet, the
 * newest open complaint with its tracker, today's visitors, and the last two ledger lines. It draws data and decides
 * nothing about money. No Pay, no View ledger, no Receipt, no complaint buttons: those arrive with their features.
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

      <DuesCard data={data} />

      <section className="flex flex-col gap-3">
        <SectionHeader title={t("complaints.title")} />
        {data.complaint === null ? <p className="text-body text-ink-2">{t("complaint.none")}</p> : <ComplaintCard complaint={data.complaint} others={data.otherOpenComplaints} />}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t("visitors.title")} />
        <p className="text-body">{visitorsText(data.visitors.length)}</p>
        {data.visitors.length > 0 && (
          <ul>
            {data.visitors.map((visitor) => (
              <li key={`${visitor.name}-${visitor.expectedAt}`} className="tnum border-b border-hairline py-2 text-body">
                {t("visitors.row", { name: visitor.name, time: formatTimeIst(visitor.expectedAt) })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t("recent.title")} />
        {data.recent.length === 0 ? (
          <p className="text-body text-ink-2">{t("recent.none")}</p>
        ) : (
          <ul>
            {data.recent.map((entry, index) => (
              <LedgerLine key={`${entry.date}-${index}`} date={formatDay(entry.date)} particulars={entryLabel(entry.entryType)} amount={entry.amountPaise} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
