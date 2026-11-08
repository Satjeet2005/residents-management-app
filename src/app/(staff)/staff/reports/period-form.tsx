"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { periodLabel, periodQuery } from "@/lib/reports/period";

const SELECT = "min-h-12 min-w-0 flex-1 rounded-control border-2 border-control bg-paper px-4 text-body text-ink";

/** The address of the report for the month picked in the select: the value is the `?period=YYYY-MM` the page reads. */
export const periodHrefOf = (value: string): string => `/staff/reports?period=${encodeURIComponent(value)}`;

/**
 * The month selector. Choosing a month shows it at once (the page navigates; there is no Show button to press). It is still a plain GET form, so without a script
 * a Show button, kept inside <noscript>, sends the same address. The months are the ones that have bills, none in the future; a month typed into the address that
 * has none is added so the select shows what the page shows.
 */
export function PeriodForm({ period, periods }: { period: CalendarDate; periods: readonly CalendarDate[] }) {
  const router = useRouter();
  const options = [...new Set([period, ...periods])].sort().reverse();
  return (
    <form method="get" action="/staff/reports" aria-label={t("committee.period.form")} className="flex items-center gap-3">
      <label htmlFor="report-period" className="shrink-0 text-body font-semibold">
        {t("committee.period.label")}
      </label>
      <select id="report-period" name="period" defaultValue={periodQuery(period)} onChange={(event) => router.push(periodHrefOf(event.target.value))} className={SELECT}>
        {options.map((p) => (
          <option key={p} value={periodQuery(p)}>
            {periodLabel(p)}
          </option>
        ))}
      </select>
      <noscript>
        <Button type="submit" variant="outlined">
          {t("committee.period.show")}
        </Button>
      </noscript>
    </form>
  );
}
