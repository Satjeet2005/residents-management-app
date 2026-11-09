import { Money } from "@/components/ui/money";
import { t } from "@/lib/messages";
import type { AgeingRowView } from "@/server/reports/ageing-page";

const flatChip = (code: string) => <span className="tnum inline-flex min-h-7 items-center rounded-control border border-control bg-paper-2 px-2 text-caption">{code}</span>;
const daysText = (days: number): string => (days > 0 ? t("committee.drill.days", { n: days }) : t("committee.drill.notDue"));

/**
 * The flats of one age group, ONE line each at every width (D217): the flat code, the days overdue of its oldest bill in 14px secondary ink, and the total owed in the
 * group at the right, bold, in tabular figures. No name and no phone number: the page has none to show.
 */
export function AgeingRows({ rows }: { rows: readonly AgeingRowView[] }) {
  return (
    <ul className="flex list-none flex-col p-0">
      {rows.map((row) => (
        <li key={row.flatCode} className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline py-2">
          <span className="flex min-w-0 items-center gap-3">
            {flatChip(row.flatCode)}
            <span className="tnum text-caption text-ink-2">{daysText(row.oldestDaysPastDue)}</span>
          </span>
          <Money amount={BigInt(row.amountDuePaise)} size="strong" />
        </li>
      ))}
    </ul>
  );
}
