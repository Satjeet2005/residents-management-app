import { Money } from "@/components/ui/money";
import { t } from "@/lib/messages";
import { periodLabel } from "@/lib/reports/period";
import type { AgeingRowView } from "@/server/reports/ageing-page";

const flatChip = (code: string) => <span className="tnum inline-flex min-h-7 items-center rounded-control border border-control bg-paper-2 px-2 text-caption">{code}</span>;
const daysText = (days: number): string => (days > 0 ? String(days) : t("committee.drill.notDue"));

/**
 * The rows of one age group: a real table from 768px (with a caption and scope on every header; numbers right-aligned in tabular figures) and stacked cards
 * below. Flat code, the month of the bill, days overdue and the amount due. No name and no phone number: the page has none to show.
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
              <th scope="col" className="py-2 pr-4 font-semibold">{t("committee.drill.col.month")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("committee.drill.col.days")}</th>
              <th scope="col" className="py-2 text-right font-semibold">{t("committee.drill.col.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.billId} className="border-b border-hairline">
                <th scope="row" className="tnum py-2 pr-4 font-normal">{row.flatCode}</th>
                <td className="py-2 pr-4">{periodLabel(row.period)}</td>
                <td className="tnum py-2 pr-4 text-right">{daysText(row.daysPastDue)}</td>
                <td className="py-2 text-right">
                  <Money amount={BigInt(row.amountDuePaise)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col md:hidden">
        {rows.map((row) => (
          <li key={row.billId} className="flex flex-col gap-1 border-b border-hairline py-3">
            <span className="flex items-center justify-between gap-4">
              {flatChip(row.flatCode)}
              <Money amount={BigInt(row.amountDuePaise)} size="strong" />
            </span>
            <span className="text-body">{t("committee.drill.cardMonth", { month: periodLabel(row.period) })}</span>
            <span className="tnum text-body">{row.daysPastDue > 0 ? t("committee.drill.cardDays", { n: row.daysPastDue }) : t("committee.drill.notDue")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
