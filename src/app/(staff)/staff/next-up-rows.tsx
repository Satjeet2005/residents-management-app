import { ChevronIcon, WarningIcon } from "@/components/icons";
import { Money } from "@/components/ui/money";
import { StatusTag } from "@/components/ui/status-tag";
import { cx } from "@/components/ui/cx";
import { formatDay } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { reasonLine } from "@/lib/reconciliation/labels";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import { categoryLabel } from "@/lib/staff-complaints/labels";
import { noticeOf } from "@/lib/staff-complaints/row-summary";
import type { NextUpComplaint, NextUpPayment } from "@/server/staff/next-up";

const ROW = "flex min-h-14 w-full items-center gap-2 rounded-control border border-hairline bg-paper px-3 py-2";

/** A payment that needs a person: the amount and date, then one reason line (never the narration). The whole row opens the review of that row. */
export function PaymentRow({ row }: { row: NextUpPayment }) {
  const reason = row.direction === "DEBIT" ? t("recon.row.debit") : reasonLine(row);
  return (
    <li>
      <a href={workspaceHref({ importId: row.importId, lane: row.lane, row: row.id })} className={ROW}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <Money amount={BigInt(row.amountPaise)} size="strong" />
            <span className="tnum text-caption text-ink-2">{formatDay(row.txnDate)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 text-caption text-ink-2">
            <span>{reason}</span>
            {row.needsSecondApprover && (
              <span className="flex items-center gap-1 font-semibold text-caution">
                <WarningIcon size={16} />
                {t("recon.row.needsSecond")}
              </span>
            )}
          </span>
        </span>
        <ChevronIcon />
      </a>
    </li>
  );
}

/** A complaint that needs action: flat and category, one clamped line of what was said (no resident name), and the reply time only when it is notable. */
export function ComplaintRow({ row, now }: { row: NextUpComplaint; now: number }) {
  const notice = noticeOf(row, now);
  return (
    <li>
      <a href={`/staff/complaints/${row.id}`} className={ROW}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
            <span className="tnum font-semibold text-ink">{row.flatCode}</span>
            <span>{categoryLabel(row.category)}</span>
            {row.safety && <StatusTag tone="caution">{t("staffComplaints.row.safety")}</StatusTag>}
          </span>
          <span className="truncate text-body font-semibold text-accent">{row.title}</span>
          {notice !== null && (
            <span className={cx("flex items-center gap-1 text-caption font-semibold", notice.tone === "caution" ? "text-caution" : "text-ink")}>
              {notice.tone === "caution" && <WarningIcon size={16} />}
              {notice.text}
            </span>
          )}
        </span>
        <ChevronIcon />
      </a>
    </li>
  );
}
