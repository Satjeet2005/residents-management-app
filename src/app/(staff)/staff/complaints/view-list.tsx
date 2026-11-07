import Link from "next/link";
import { BOARD_VIEWS, type BoardView } from "@/domain/complaints/board-views";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { type BoardFilters, boardHref } from "@/lib/staff-complaints/board-query";
import { viewLabel, viewSentence } from "@/lib/staff-complaints/views";

/**
 * The eight views as a list of links, each with its count and ONE plain sentence. The same list is the content of the views sheet (below 1024px) and the left
 * sidebar (from 1024px). The filters stay when a view is chosen. `onSelect` lets the sheet close itself.
 */
export function ViewList({ view, counts, filters, onSelect }: { view: BoardView; counts: Record<BoardView, number>; filters: BoardFilters; onSelect?: () => void }) {
  return (
    <nav aria-label={t("staffComplaints.view.nav")}>
      <ul className="flex flex-col gap-2">
        {BOARD_VIEWS.map((v) => (
          <li key={v}>
            <Link
              href={boardHref({ view: v, filters })}
              aria-current={v === view ? "page" : undefined}
              onClick={onSelect}
              className={cx("flex min-h-12 flex-col gap-0.5 rounded-control border-2 px-3 py-2", v === view ? "border-ink bg-paper-2" : "border-control bg-paper")}
            >
              <span className="flex items-center justify-between gap-2 text-body font-semibold">
                {viewLabel(v)}
                <span className="tnum">{counts[v]}</span>
              </span>
              <span className="text-caption text-ink-2">{viewSentence(v)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
