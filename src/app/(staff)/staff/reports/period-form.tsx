import { Button } from "@/components/ui/button";
import { periodLabel, periodQuery } from "@/lib/reports/period";
import { t } from "@/lib/messages";
import type { CalendarDate } from "@/domain/time/calendar";

const SELECT = "min-h-12 rounded-control border-2 border-control bg-paper px-4 text-body text-ink";

/**
 * The month selector: a plain GET form (a select and a Show button), so it works without a script and the month is in the address. The months are the ones that
 * have bills, none in the future; a month typed into the address that has none is added so the select shows what the page shows. The button is outlined.
 */
export function PeriodForm({ period, periods }: { period: CalendarDate; periods: readonly CalendarDate[] }) {
  const options = [...new Set([period, ...periods])].sort().reverse();
  return (
    <form method="get" action="/staff/reports" aria-label={t("committee.period.form")} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="report-period" className="text-body font-semibold">
          {t("committee.period.label")}
        </label>
        <select id="report-period" name="period" defaultValue={periodQuery(period)} className={SELECT}>
          {options.map((p) => (
            <option key={p} value={periodQuery(p)}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outlined">
        {t("committee.period.show")}
      </Button>
    </form>
  );
}
