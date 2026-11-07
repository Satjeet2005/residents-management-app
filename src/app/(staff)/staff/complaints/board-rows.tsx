import Link from "next/link";
import { StatusTag } from "@/components/ui/status-tag";
import { t } from "@/lib/messages";
import { categoryLabel, sourceTag, staffStatusLabel, urgencyLabel, urgencyTone } from "@/lib/staff-complaints/labels";
import { ageWords, slaWords } from "@/lib/staff-complaints/time";
import type { BoardRow } from "@/server/complaints/board";

const urgencyTag = (row: BoardRow) => <StatusTag tone={urgencyTone(row.urgency)}>{urgencyLabel(row.urgency)}</StatusTag>;

function SourceTag({ row }: { row: BoardRow }) {
  const tag = sourceTag({ source: row.source, needsReview: row.needsReview });
  return tag === null ? null : <StatusTag tone={tag.tone}>{tag.text}</StatusTag>;
}

const openLink = (row: BoardRow) => (
  <Link href={`/staff/complaints/${row.id}`} className="inline-flex min-h-12 items-center break-words font-semibold text-accent underline underline-offset-4">
    {row.title}
  </Link>
);

const flatChip = (row: BoardRow) => <span className="tnum inline-flex min-h-7 items-center rounded-control border border-control bg-paper-2 px-2 text-caption">{row.flatCode}</span>;
const assigneeText = (row: BoardRow): string => row.assignee?.name ?? t("staffComplaints.unassigned");
const reply = (row: BoardRow, now: number): string => slaWords({ sla: row.sla, responseDueAt: row.responseDueAt, now });

/** The complaints of a lane: a real table from 768px, stacked cards below. Every cell is words; the urgency and the source are tags with text. */
export function BoardRows({ rows, caption, now }: { rows: readonly BoardRow[]; caption: string; now: number }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="py-2 pr-4 font-semibold">{t("staffComplaints.col.complaint")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("staffComplaints.col.category")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("staffComplaints.col.urgency")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("staffComplaints.col.status")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("staffComplaints.col.assignee")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("staffComplaints.col.age")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("staffComplaints.col.reply")}</th>
              <th scope="col" className="py-2 font-semibold">{t("staffComplaints.col.source")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-hairline">
                <td className="py-3 pr-4">
                  <span className="flex flex-col items-start gap-1">
                    {flatChip(row)}
                    {openLink(row)}
                  </span>
                </td>
                <td className="py-3 pr-4">{categoryLabel(row.category)}</td>
                <td className="py-3 pr-4">{urgencyTag(row)}</td>
                <td className="py-3 pr-4">{staffStatusLabel(row.status)}</td>
                <td className="py-3 pr-4">{assigneeText(row)}</td>
                <td className="tnum py-3 pr-4">{ageWords(row.ageMinutes)}</td>
                <td className="py-3 pr-4">{reply(row, now)}</td>
                <td className="py-3">
                  <SourceTag row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 border-b border-hairline py-3">
            <span className="flex flex-wrap items-center gap-2">
              {flatChip(row)}
              {urgencyTag(row)}
              <SourceTag row={row} />
            </span>
            {openLink(row)}
            <span className="text-body">{t("staffComplaints.card.line", { category: categoryLabel(row.category), status: staffStatusLabel(row.status), assignee: assigneeText(row) })}</span>
            <span className="tnum text-body">{t("staffComplaints.age", { age: ageWords(row.ageMinutes) })}</span>
            <span className="text-body">{reply(row, now)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
