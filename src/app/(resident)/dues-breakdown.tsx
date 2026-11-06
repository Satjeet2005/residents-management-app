import type { Dues } from "@/domain/billing/dues";
import { LedgerLine } from "@/components/ui/ledger-line";
import { LedgerTotal } from "@/components/ui/ledger-total";
import { Hairline } from "@/components/ui/rules";
import type { CalendarDate } from "@/domain/time/calendar";
import { formatDay, formatDayYear, monthName } from "@/lib/format-date";
import { dailyGrowthText, workingLines } from "@/lib/home-text";
import { t } from "@/lib/messages";

/**
 * What makes up the amount due (D23): for each open bill, the bill, the payments on it, the late fee so far (or, once the
 * principal is paid, the fee that accrued until then, D107); then the working of the fee in full, and the total under a double rule. Read-only: there is nothing here to press.
 */
export function DuesBreakdown({ dues, asOf }: { dues: Dues; asOf: CalendarDate }) {
  const withWorking = dues.openBills.filter((bill) => bill.working !== null);
  const daily = dailyGrowthText(dues);
  return (
    <div className="flex flex-col gap-4">
      <p className="tnum text-caption text-ink-2">{t("dues.sheet.asOf", { date: formatDayYear(asOf) })}</p>
      <ul>
        {dues.openBills.map((bill) => (
          <li key={bill.billId} className="contents">
            <ul>
              <LedgerLine
                date={formatDay(bill.period)}
                particulars={
                  <>
                    <span>{bill.kind === "FEE_ONLY" ? t("dues.sheet.billIssuedPaid", { month: monthName(bill.period) }) : t("dues.sheet.billIssued", { month: monthName(bill.period) })}</span>
                    <span className="block text-caption text-ink-2">{t("dues.sheet.due", { date: formatDay(bill.dueOn) })}</span>
                  </>
                }
                amount={bill.billAmountPaise}
              />
              {bill.payments.map((payment, index) => (
                <LedgerLine key={`${payment.date}-${index}`} date={formatDay(payment.date)} particulars={t("dues.sheet.payment")} amount={-payment.amountPaise} />
              ))}
              {bill.kind === "FEE_ONLY" && bill.settledOn !== null && (
                <LedgerLine date={formatDay(bill.settledOn)} particulars={t("dues.sheet.lateFeeAccrued", { date: formatDay(bill.settledOn) })} amount={bill.feeAccruedPaise} />
              )}
              {bill.kind === "PRINCIPAL_OPEN" && bill.overdueDays > 0 && (
                <LedgerLine
                  date={formatDay(asOf)}
                  particulars={bill.overdueDays === 1 ? t("dues.sheet.lateFeeOne", { days: 1 }) : t("dues.sheet.lateFee", { days: bill.overdueDays })}
                  amount={bill.feePaise}
                />
              )}
            </ul>
            <Hairline />
          </li>
        ))}
      </ul>
      <LedgerTotal label={t("dues.sheet.total")} amount={dues.amountDuePaise} />
      {withWorking.length > 0 && (
        <section aria-labelledby="working-title" className="flex flex-col gap-3 rounded-control border border-control bg-paper-2 p-4">
          <h3 id="working-title" className="text-body font-semibold">
            {t("working.title")}
          </h3>
          {withWorking.map((bill) => {
            const lines = workingLines(bill, bill.working as NonNullable<typeof bill.working>);
            return (
              <div key={bill.billId} className="flex flex-col gap-1">
                {dues.openBills.length > 1 && <p className="text-caption text-ink-2">{lines.name}</p>}
                {lines.segments.map((line) => (
                  <p key={line} className="tnum text-body">
                    {line}
                  </p>
                ))}
                <p className="tnum text-body font-semibold">{lines.total}</p>
              </div>
            );
          })}
          {daily !== null && <p className="text-body">{daily}</p>}
        </section>
      )}
    </div>
  );
}
