import { Money } from "@/components/ui/money";
import { t } from "@/lib/messages";
import { billsText } from "@/lib/reports/ageing";
import type { AgeingRowView } from "@/server/reports/ageing-page";

const flatChip = (code: string) => <span className="tnum inline-flex min-h-7 items-center rounded-control border border-control bg-paper-2 px-2 text-caption">{code}</span>;
const daysText = (days: number): string => (days > 0 ? t("committee.drill.days", { n: days }) : t("committee.drill.notDue"));

/**
 * The flats of one age group: a real table from 768px (a caption and a scope on every header; numbers right-aligned in tabular figures) and stacked cards below.
 * Per FLAT: its code, its total owed in the group, how many bills when it has more than one, and the days overdue of its oldest bill. No name and no phone number:
 * the page has none to show.
 */
export function AgeingRows({ rows, caption }: { rows: readonly AgeingRowView[]; caption: string }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="py-2 pr-4 font-semibold">{t("committee.drill.col.flat")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("committee.drill.col.bills")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("committee.drill.col.days")}</th>
              <th scope="col" className="py-2 text-right font-semibold">{t("committee.drill.col.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.flatCode} className="border-b border-hairline">
                <th scope="row" className="tnum py-2 pr-4 font-normal">{row.flatCode}</th>
                <td className="tnum py-2 pr-4 text-right">{row.bills}</td>
                <td className="tnum py-2 pr-4 text-right">{row.oldestDaysPastDue > 0 ? row.oldestDaysPastDue : t("committee.drill.notDue")}</td>
                <td className="py-2 text-right">
                  <Money amount={BigInt(row.amountDuePaise)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex list-none flex-col p-0 md:hidden">
        {rows.map((row) => (
          <li key={row.flatCode} className="flex flex-col gap-1 border-b border-hairline py-3">
            <span className="flex items-center justify-between gap-4">
              {flatChip(row.flatCode)}
              <Money amount={BigInt(row.amountDuePaise)} size="strong" />
            </span>
            {row.bills > 1 && <span className="tnum text-body">{billsText(row.bills)}</span>}
            <span className="tnum text-body">{daysText(row.oldestDaysPastDue)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
