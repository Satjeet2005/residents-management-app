import { Ledger, type LedgerRow } from "@/components/committee/ledger";
import { CheckIcon, WarningIcon } from "@/components/icons";
import type { InterventionType, ReconciliationLine } from "@/domain/reports/reconciliation";
import { t } from "@/lib/messages";
import { countText } from "@/lib/reports/cards";
import { minutesText } from "@/lib/reports/share";

const typeLabel = (type: InterventionType): string => {
  switch (type) {
    case "MANUAL":
      return t("committee.recon.type.manual");
    case "APPROVED":
      return t("committee.recon.type.approved");
    case "REJECTED":
      return t("committee.recon.type.rejected");
    case "IGNORE":
      return t("committee.recon.type.ignore");
  }
};

/**
 * The bank statement matching of the last 30 days (D212): ONE ledger that accounts for every bank entry (matched automatically, matched by hand, waiting for a
 * person, waiting for approval only when there are some, not maintenance payments, which add up to the entries), the tick "All n accounted for" ONLY when every
 * import's rows add up (read back from the database for each one, never assumed), and the table of manual decisions ONLY when at least one count is above zero.
 * Counts only: no flat and no name. The definitions are in the page's one expander.
 */
export function ReconciliationBlock({ line }: { line: ReconciliationLine }) {
  if (line.imports === 0) return <p className="text-body">{t("committee.recon.none")}</p>;
  const anyManual = line.interventions.some((i) => i.count > 0);
  const parts: LedgerRow[] = [
    { label: t("committee.recon.part.auto"), value: countText(line.postedAutomatically) },
    { label: t("committee.recon.part.hand"), value: countText(line.postedByHand) },
    { label: t("committee.recon.part.person"), value: countText(line.waitingForPerson) },
    ...(line.waitingForApproval > 0 ? [{ label: t("committee.recon.part.approval"), value: countText(line.waitingForApproval) }] : []),
    { label: t("committee.recon.part.other"), value: countText(line.notMaintenance) },
  ];
  const ledgerFigure = ["bankWindow", "bankAuto", "bankHand", "bankPerson", ...(line.waitingForApproval > 0 ? ["bankApproval"] : []), "bankOther"].join(" ");
  return (
    <section data-block="" aria-label={t("committee.recon.ledger")} className="flex flex-col gap-3">
      {line.rowsImported === 0 ? (
        <p className="text-body">{t("committee.recon.noEntries")}</p>
      ) : (
        <Ledger figure={ledgerFigure} parts={parts} total={{ label: t("committee.recon.total"), value: countText(line.rowsImported) }} />
      )}
      {line.allAccounted === true ? (
        line.rowsImported > 0 && (
          <p data-figure="bankAccounted" className="flex items-center gap-2 text-body font-semibold">
            <CheckIcon size={20} />
            {t("committee.recon.accounted", { n: countText(line.rowsImported) })}
          </p>
        )
      ) : (
        <p role="alert" className="flex items-center gap-2 rounded-control border-2 border-caution p-3 text-body font-semibold text-caution">
          <WarningIcon size={20} />
          {t("committee.recon.notAccounted", { n: line.notAccounted, d: line.imports })}
        </p>
      )}
      {anyManual && (
        <table className="w-full text-left text-body">
          <caption className="pb-2 text-left font-semibold">{t("committee.recon.interventions.caption")}</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="py-2 pr-4 font-semibold">{t("committee.recon.col.type")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("committee.recon.col.count")}</th>
              <th scope="col" className="py-2 text-right font-semibold">{t("committee.recon.col.median")}</th>
            </tr>
          </thead>
          <tbody>
            {line.interventions.map((i) => (
              <tr key={i.type} className="border-b border-hairline">
                <th scope="row" className="py-2 pr-4 font-normal">{typeLabel(i.type)}</th>
                <td className="tnum py-2 pr-4 text-right">{i.count}</td>
                <td className="tnum py-2 text-right">{minutesText(i.medianMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
