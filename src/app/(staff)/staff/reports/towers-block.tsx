import Link from "next/link";
import { DataTable } from "@/components/committee/data-table";
import { ChevronIcon } from "@/components/icons";
import type { TowerRollup } from "@/domain/reports/towers";
import { t } from "@/lib/messages";
import { countText } from "@/lib/reports/cards";
import { TOWERS_SHOWN, towersHref, towersTable } from "@/lib/reports/towers";

/**
 * "Towers with the most unpaid" (D182, D216): a real table of the FIVE towers that owe the most, straight under the heading: Tower, Owed, Flats owing, Over 90 days
 * (four columns, numbers right-aligned in tabular figures), and as the LAST element one full-width row "All 28 towers" that opens the towers page (D217). Tower names and
 * counts only: no flat code, no name, and no sentence about why a tower owes.
 */
export function TowersBlock({ rollup }: { rollup: TowerRollup }) {
  if (rollup.towers.length === 0) return null;
  const table = towersTable({ towers: rollup.towers.slice(0, TOWERS_SHOWN), total: rollup.total }, false);
  return (
    <section data-block="" data-figure="towers" aria-labelledby="committee-towers" className="flex flex-col gap-2">
      <h2 id="committee-towers" className="text-title font-semibold">
        {t("committee.towers.title")}
      </h2>
      <DataTable caption={table.caption} columns={table.columns} rows={table.rows} headerNoWrap />
      {rollup.towers.length > TOWERS_SHOWN && (
        <Link href={towersHref("owed")} className="flex min-h-14 w-full items-center justify-between gap-4 rounded-control border border-hairline px-3 text-body font-semibold">
          {t("committee.towers.all", { n: countText(rollup.towers.length) })}
          <span aria-hidden="true" className="shrink-0">
            <ChevronIcon size={24} />
          </span>
        </Link>
      )}
    </section>
  );
}
