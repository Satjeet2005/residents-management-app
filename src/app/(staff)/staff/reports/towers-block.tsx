import { TableToggle } from "@/components/charts/chart-parts";
import { Money } from "@/components/ui/money";
import type { TowerRollup, TowerRow } from "@/domain/reports/towers";
import { t } from "@/lib/messages";
import { countText } from "@/lib/reports/cards";
import { TOWERS_SHOWN, flatsOwingText, over90Text, towerName, towersTableOf } from "@/lib/reports/towers";

function TowerList({ rows }: { rows: readonly TowerRow[] }) {
  return (
    <ul className="flex list-none flex-col p-0">
      {rows.map((row) => (
        <li key={row.tower} className="flex flex-col gap-1 border-b border-hairline py-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-body font-semibold">{towerName(row.tower)}</span>
            <Money amount={row.amountDuePaise} size="strong" />
          </div>
          <span className="tnum text-body text-ink-2">{t("committee.towers.line", { flats: flatsOwingText(row.flats), over90: over90Text(row.flatsOver90) })}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Towers with the most unpaid" under What is owed (D182): the ten towers that owe the most, each with its flats owing, what it owes (unpaid bills plus late fees)
 * and its flats over 90 days; "See all 24 towers" opens the rest; the numbers behind the list, with a total row that equals Total owed, are one tap away. Tower
 * names and counts only. It says nothing about why a tower owes: it only says how much.
 */
export function TowersBlock({ rollup }: { rollup: TowerRollup }) {
  if (rollup.towers.length === 0) return null;
  const top = rollup.towers.slice(0, TOWERS_SHOWN);
  const rest = rollup.towers.slice(TOWERS_SHOWN);
  return (
    <section data-figure="towers" aria-labelledby="committee-towers" className="flex flex-col gap-2">
      <h3 id="committee-towers" className="text-title font-semibold">
        {t("committee.towers.title")}
      </h3>
      <p className="text-body text-ink-2">{t("committee.towers.hint")}</p>
      <TowerList rows={top} />
      {rest.length > 0 && (
        <details>
          <summary className="flex min-h-12 cursor-pointer items-center text-body font-semibold text-accent underline underline-offset-4">{t("committee.towers.seeAll", { n: countText(rollup.towers.length) })}</summary>
          <TowerList rows={rest} />
        </details>
      )}
      <TableToggle table={towersTableOf(rollup)} />
    </section>
  );
}
