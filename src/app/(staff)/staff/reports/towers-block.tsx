import { DataTable } from "@/components/committee/data-table";
import type { TowerRollup } from "@/domain/reports/towers";
import { t } from "@/lib/messages";
import { TOWERS_SHOWN, towersTable } from "@/lib/reports/towers";

/**
 * "Towers with the most unpaid" (D182, D216): a real table of the FIVE towers that owe the most, straight under the heading: Tower, Owed, Flats owing, Over 90 days
 * (four columns, numbers right-aligned in tabular figures). Tower names and counts only: no flat code, no name, and no sentence about why a tower owes.
 */
export function TowersBlock({ rollup }: { rollup: TowerRollup }) {
  if (rollup.towers.length === 0) return null;
  const table = towersTable({ towers: rollup.towers.slice(0, TOWERS_SHOWN), total: rollup.total }, false);
  return (
    <section data-block="" data-figure="towers" aria-labelledby="committee-towers" className="flex flex-col gap-2">
      <h2 id="committee-towers" className="text-title font-semibold">
        {t("committee.towers.title")}
      </h2>
      <DataTable caption={table.caption} columns={table.columns} rows={table.rows} />
    </section>
  );
}
