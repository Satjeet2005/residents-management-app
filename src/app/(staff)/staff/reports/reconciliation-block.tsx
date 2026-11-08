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
 * The bank statement matching of the last 30 days: ONE summary sentence that accounts for every bank entry (matched automatically, matched by hand and waiting for
 * approval only when there are some, waiting for a person, not maintenance payments), the tick "All n accounted for" ONLY when every import's rows add up (read
 * back from the database for each one, never assumed), and always "Matched by hand (last 30 days): n". The table of manual decisions appears ONLY when at
 * least one count is above zero. Counts only: no flat and no name.
 */
export function ReconciliationBlock({ line }: { line: ReconciliationLine }) {
  if (line.imports === 0) return <p className="text-body">{t("committee.recon.none")}</p>;
  const anyManual = line.interventions.some((i) => i.count > 0);
  const parts = [
    t("committee.recon.part.auto", { n: countText(line.postedAutomatically) }),
    ...(line.postedByHand > 0 ? [t("committee.recon.part.hand", { n: countText(line.postedByHand) })] : []),
    t("committee.recon.part.person", { n: countText(line.waitingForPerson) }),
    ...(line.waitingForApproval > 0 ? [t("committee.recon.part.approval", { n: countText(line.waitingForApproval) })] : []),
    t("committee.recon.part.other", { n: countText(line.notMaintenance) }),
  ].join(", ");
  return (
    <>
      <p className="tnum text-body">
        {line.rowsImported === 0 ? t("committee.recon.noEntries") : line.rowsImported === 1 ? t("committee.recon.summaryOne", { parts }) : t("committee.recon.summary", { n: countText(line.rowsImported), parts })}
      </p>
      {line.allAccounted === true ? (
        line.rowsImported > 0 && (
          <p className="flex items-center gap-2 text-body font-semibold">
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
      <p className="tnum text-body">{t("committee.recon.byHand", { n: countText(line.postedByHand) })}</p>
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
    </>
  );
}
