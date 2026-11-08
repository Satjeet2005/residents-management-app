import { ChevronIcon, WarningIcon } from "@/components/icons";
import { Money } from "@/components/ui/money";
import { cx } from "@/components/ui/cx";
import { formatRupees } from "@/domain/money/money";
import { formatDay, formatDayLong } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { narrationPreview, reasonLine } from "@/lib/reconciliation/labels";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import type { Viewer } from "@/lib/reconciliation/permission-view";
import type { Lane, RowCard } from "@/lib/reconciliation/types";
import { AwaitingDetails, IgnoredDetails, PostedDetails } from "./lane-details";
import { rowLinkId } from "./review-panel";
import { RowLink } from "./row-link";

/** A credit at or above the society's threshold needs a second approver (D14); the threshold is a setting, never a number written here. */
export const needsSecondApprover = (row: Pick<RowCard, "direction" | "amountPaise">, thresholdPaise: string): boolean => row.direction === "CREDIT" && BigInt(row.amountPaise) >= BigInt(thresholdPaise);

/** What a card says on its last line, by lane. A row that needs a person says why; the other lanes keep their details. */
function LastLine({ row, lane, viewer, thresholdPaise }: { row: RowCard; lane: Lane; viewer: Viewer; thresholdPaise: string }) {
  switch (lane) {
    case "NEEDS_YOU":
      return (
        <span className="flex flex-wrap items-center gap-x-3 text-caption text-ink-2">
          <span>{row.direction === "DEBIT" ? t("recon.row.debit") : reasonLine(row)}</span>
          {needsSecondApprover(row, thresholdPaise) && (
            <span className="flex items-center gap-1 font-semibold text-caution">
              <WarningIcon size={16} />
              {t("recon.row.needsSecond")}
            </span>
          )}
        </span>
      );
    case "AWAITING_APPROVAL":
      return <AwaitingDetails row={row} viewer={viewer} />;
    case "MATCHED":
      return <PostedDetails row={row} />;
    case "NOT_MAINTENANCE":
      return <IgnoredDetails row={row} />;
  }
}

/** The three lines every row has: the amount (bold) and the date, the narration clamped to two lines, then the last line of its lane. */
function Anatomy({ row, lane, viewer, thresholdPaise }: { row: RowCard; lane: Lane; viewer: Viewer; thresholdPaise: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-baseline justify-between gap-2">
        <Money amount={BigInt(row.amountPaise)} size="strong" />
        <span className="tnum text-caption text-ink-2">{formatDay(row.txnDate)}</span>
      </span>
      <span className="line-clamp-2 break-words text-body">{narrationPreview(row.narration)}</span>
      <LastLine row={row} lane={lane} viewer={viewer} thresholdPaise={thresholdPaise} />
    </span>
  );
}

/** "Review 46,445 rupees from 21 October": what a screen reader says for the card that opens the review. */
function reviewName(row: RowCard, selected: boolean): string {
  const values = { amount: formatRupees(BigInt(row.amountPaise)).slice(1), date: formatDayLong(row.txnDate) };
  return selected ? t("recon.row.reviewingLabel", values) : t("recon.row.reviewLabel", values);
}

const CARD = "flex w-full items-center gap-2 rounded-control";

/**
 * The rows of a lane (D191): one card for each row. In Needs you the WHOLE card is the one control that opens the review (the row is in the URL as ?row=); the selected
 * card has a 2px border. The other lanes have no review to open, so their cards are plain, and Awaiting approval keeps its Approve and Reject buttons inside the card.
 */
export function RowsView({ rows, caption, importId, lane, selectedId, viewer, thresholdPaise }: { rows: readonly RowCard[]; caption: string; importId: string; lane: Lane; selectedId: string | null; viewer: Viewer; thresholdPaise: string }) {
  return (
    <ul aria-label={caption} className="flex max-w-3xl flex-col gap-2">
      {rows.map((row) => {
        const selected = row.id === selectedId;
        return (
          <li key={row.id}>
            {lane === "NEEDS_YOU" ? (
              <RowLink
                id={rowLinkId(row.id)}
                href={workspaceHref({ importId, lane, row: row.id })}
                aria-current={selected ? "true" : undefined}
                aria-label={reviewName(row, selected)}
                className={cx(CARD, "bg-paper", selected ? "border-2 border-ink px-[10px] py-[6px]" : "border border-hairline px-[11px] py-[7px]")}
              >
                <Anatomy row={row} lane={lane} viewer={viewer} thresholdPaise={thresholdPaise} />
                <ChevronIcon />
              </RowLink>
            ) : (
              <div className={cx(CARD, "border border-hairline px-[11px] py-[7px]")}>
                <Anatomy row={row} lane={lane} viewer={viewer} thresholdPaise={thresholdPaise} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
