import { CheckIcon, WarningIcon } from "@/components/icons";
import type { InterventionType, ReconciliationLine } from "@/domain/reports/reconciliation";
import { t } from "@/lib/messages";
import { countText } from "@/lib/reports/cards";
import { minutesText, shareText } from "@/lib/reports/share";

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
 * The reconciliation of the last 30 days, in THREE lines (rows posted automatically with their share, rows waiting for a person and for approval, rows that are not
 * maintenance), then whether every import's rows add up (read back from the database for each one). The manual interventions table appears ONLY when at least one
 * count is above zero; otherwise the section says there were no manual decisions. Counts only: no flat and no name.
 */
export function ReconciliationBlock({ line }: { line: ReconciliationLine }) {
  if (line.imports === 0) return <p className="text-body">{t("committee.recon.none")}</p>;
  const anyManual = line.interventions.some((i) => i.count > 0);
  return (
    <>
      <ul className="tnum flex flex-col gap-2 text-body">
        <li>
          {line.rowsImported === 0
            ? t("committee.recon.lineNoRows")
            : t("committee.recon.lineAuto", { n: countText(line.postedAutomatically), d: countText(line.rowsImported), share: shareText(line.postedAutomatically, line.rowsImported) })}
        </li>
        <li>{t("committee.recon.lineWaiting", { a: countText(line.waitingForPerson), b: countText(line.waitingForApproval) })}</li>
        <li>{t("committee.recon.lineNotMaintenance", { n: countText(line.notMaintenance) })}</li>
      </ul>
      {line.allAccounted === true ? (
        <p className="flex items-center gap-2 text-body font-semibold">
          <CheckIcon size={20} />
          {line.imports === 1 ? t("committee.recon.accountedOne") : t("committee.recon.accountedMany", { n: line.imports })}
        </p>
      ) : (
        <p role="alert" className="flex items-center gap-2 rounded-control border-2 border-caution p-3 text-body font-semibold text-caution">
          <WarningIcon size={20} />
          {t("committee.recon.notAccounted", { n: line.notAccounted, d: line.imports })}
        </p>
      )}
      {anyManual ? (
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
      ) : (
        <p className="text-body">{t("committee.recon.noManual")}</p>
      )}
    </>
  );
}
