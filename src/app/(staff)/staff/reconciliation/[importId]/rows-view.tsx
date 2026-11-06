import Link from "next/link";
import { StatusTag, type StatusTone } from "@/components/ui/status-tag";
import { Money } from "@/components/ui/money";
import { formatRupees } from "@/domain/money/money";
import { formatDay } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { confidenceLabel, shortNarration } from "@/lib/reconciliation/labels";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import type { Confidence, Lane, RowCard } from "@/lib/reconciliation/types";
import { rowLinkId } from "./review-panel";

const TONE: Record<Confidence, StatusTone> = { HIGH: "positive", MEDIUM: "neutral", LOW: "caution", NONE: "neutral" };

/** The best candidate flat as a chip, and the matcher's confidence as a tag in words. */
function Candidate({ row }: { row: RowCard }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="tnum inline-flex min-h-7 items-center rounded-control border border-control bg-paper-2 px-2 text-caption">{row.bestFlat ?? t("recon.row.noFlat")}</span>
      <StatusTag tone={TONE[row.confidence ?? "NONE"]}>{confidenceLabel(row.confidence)}</StatusTag>
    </span>
  );
}

/** The link that opens a row in the review panel (the row is in the URL as ?row=). Only rows that wait for a person have one. */
function ReviewLink({ row, importId, lane, selectedId }: { row: RowCard; importId: string; lane: Lane; selectedId: string | null }) {
  return (
    <Link
      id={rowLinkId(row.id)}
      href={workspaceHref({ importId, lane, row: row.id })}
      aria-current={row.id === selectedId ? "true" : undefined}
      aria-label={t("recon.row.reviewLabel", { amount: formatRupees(BigInt(row.amountPaise)), date: formatDay(row.txnDate) })}
      className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4 aria-[current=true]:text-ink"
    >
      {row.id === selectedId ? t("recon.row.reviewing") : t("recon.row.review")}
    </Link>
  );
}

const amountOf = (row: RowCard) => (
  <span className="flex flex-col">
    <Money amount={BigInt(row.amountPaise)} size="strong" />
    {row.direction === "DEBIT" && <span className="text-caption text-ink-2">{t("recon.row.debit")}</span>}
  </span>
);

/** The rows of a lane: a real table from 768px, stacked cards below. */
export function RowsView({ rows, caption, importId, lane, selectedId }: { rows: readonly RowCard[]; caption: string; importId: string; lane: Lane; selectedId: string | null }) {
  const reviewable = lane === "NEEDS_YOU";
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="py-2 pr-4 font-semibold">{t("recon.col.date")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("recon.col.amount")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("recon.col.narration")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("recon.col.candidate")}</th>
              {reviewable && <th scope="col" className="py-2 font-semibold"><span className="sr-only">{t("recon.col.review")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-hairline">
                <td className="tnum py-2 pr-4">{formatDay(row.txnDate)}</td>
                <td className="py-2 pr-4 text-right">{amountOf(row)}</td>
                <td className="break-words py-2 pr-4">{shortNarration(row.narration)}</td>
                <td className="py-2 pr-4">
                  <Candidate row={row} />
                </td>
                {reviewable && (
                  <td className="py-1">
                    <ReviewLink row={row} importId={importId} lane={lane} selectedId={selectedId} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 border-b border-hairline py-3">
            <span className="flex items-start justify-between gap-4">
              <span className="tnum text-body">{formatDay(row.txnDate)}</span>
              {amountOf(row)}
            </span>
            <span className="break-words text-body">{shortNarration(row.narration)}</span>
            <Candidate row={row} />
            {reviewable && <ReviewLink row={row} importId={importId} lane={lane} selectedId={selectedId} />}
          </li>
        ))}
      </ul>
    </>
  );
}
