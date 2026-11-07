import Link from "next/link";
import { WarningIcon } from "@/components/icons";
import { StatusTag } from "@/components/ui/status-tag";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { categoryLabel, staffStatusLabel, urgencyLabel, urgencyTone } from "@/lib/staff-complaints/labels";
import { rowSummary } from "@/lib/staff-complaints/row-summary";
import { ageWords, slaWords } from "@/lib/staff-complaints/time";
import type { BoardRow } from "@/server/complaints/board-views";

const flatChip = (code: string) => <span className="tnum inline-flex min-h-7 items-center rounded-control border border-control bg-paper-2 px-2 text-caption">{code}</span>;
const safetyTag = () => <StatusTag tone="caution">{t("staffComplaints.row.safety")}</StatusTag>;
const href = (row: BoardRow): string => `/staff/complaints/${row.id}`;

/** One compact card per complaint (at most about 100px on a phone): the whole card is the link. Four lines, the last only when it is notable. */
function Card({ row, now }: { row: BoardRow; now: number }) {
  const s = rowSummary(row, now);
  return (
    <li>
      <Link href={href(row)} className="flex min-h-12 flex-col gap-0.5 rounded-control border border-hairline bg-paper px-3 py-2">
        <span className="flex flex-wrap items-center gap-2">
          {flatChip(s.flat)}
          {s.urgency !== null && <StatusTag tone={s.urgency.critical ? "caution" : "neutral"}>{s.urgency.text}</StatusTag>}
          {s.safety && safetyTag()}
        </span>
        <span className="truncate text-body font-semibold text-accent">{s.title}</span>
        <span className="text-caption text-ink-2">{s.meta}</span>
        {s.notice !== null && (
          <span className={cx("flex items-center gap-1 text-caption font-semibold", s.notice.tone === "caution" ? "text-caution" : "text-ink")}>
            {s.notice.tone === "caution" && <WarningIcon size={16} />}
            {s.notice.text}
          </span>
        )}
      </Link>
    </li>
  );
}

const th = "py-2 pr-4 font-semibold";

/** The complaints of a page: a real table from 768px (flat, title, category, urgency, status, assignee, reply, age), compact cards below. */
export function BoardRows({ rows, caption, now }: { rows: readonly BoardRow[]; caption: string; now: number }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className={th}>{t("staffComplaints.col.flat")}</th>
              <th scope="col" className={th}>{t("staffComplaints.col.complaint")}</th>
              <th scope="col" className={th}>{t("staffComplaints.col.category")}</th>
              <th scope="col" className={th}>{t("staffComplaints.col.urgency")}</th>
              <th scope="col" className={th}>{t("staffComplaints.col.status")}</th>
              <th scope="col" className={th}>{t("staffComplaints.col.assignee")}</th>
              <th scope="col" className={th}>{t("staffComplaints.col.reply")}</th>
              <th scope="col" className="py-2 font-semibold">{t("staffComplaints.col.age")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-hairline">
                <td className="py-2 pr-4">{flatChip(row.flatCode)}</td>
                <td className="py-2 pr-4">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={href(row)} className="inline-flex min-h-12 items-center break-words font-semibold text-accent underline underline-offset-4">
                      {row.title}
                    </Link>
                    {row.safety && safetyTag()}
                  </span>
                </td>
                <td className="py-2 pr-4">{categoryLabel(row.category)}</td>
                <td className="py-2 pr-4">
                  <StatusTag tone={urgencyTone(row.urgency)}>{urgencyLabel(row.urgency)}</StatusTag>
                </td>
                <td className="py-2 pr-4">{staffStatusLabel(row.status)}</td>
                <td className="py-2 pr-4">{row.assignee?.name ?? t("staffComplaints.unassigned")}</td>
                <td className="py-2 pr-4">{slaWords({ sla: row.sla, responseDueAt: row.responseDueAt, now })}</td>
                <td className="tnum py-2">{ageWords(row.ageMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <Card key={row.id} row={row} now={now} />
        ))}
      </ul>
    </>
  );
}
