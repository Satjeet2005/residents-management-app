import { CheckIcon, WarningIcon } from "@/components/icons";
import type { InterventionType, ReconciliationLine } from "@/domain/reports/reconciliation";
import { t } from "@/lib/messages";
import { minutesText, shareText } from "@/lib/reports/share";
import { StatRow } from "./stat-row";

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
 * The reconciliation line of the last 30 days: the bank rows by what became of them, the share posted automatically, whether every import's rows add up (read
 * back from the database for each one) and the manual interventions by decision type with the median time from import to decision. Counts only: no flat and no name.
 */
export function ReconciliationBlock({ line }: { line: ReconciliationLine }) {
  const heading = (
    <h2 id="committee-recon" className="text-title font-semibold">
      {t("committee.recon.heading")}
    </h2>
  );
  if (line.imports === 0) {
    return (
      <section aria-labelledby="committee-recon" className="flex flex-col gap-2">
        {heading}
        <p className="text-body">{t("committee.recon.none")}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="committee-recon" className="flex flex-col gap-3">
      {heading}
      <dl className="flex flex-col border-t border-hairline">
        <StatRow label={t("committee.recon.rows")}>{line.rowsImported}</StatRow>
        <StatRow label={t("committee.recon.auto")}>{line.postedAutomatically}</StatRow>
        <StatRow label={t("committee.recon.manual")}>{line.postedByHand}</StatRow>
        <StatRow label={t("committee.recon.waiting")}>{line.waitingForPerson}</StatRow>
        <StatRow label={t("committee.recon.approval")}>{line.waitingForApproval}</StatRow>
        <StatRow label={t("committee.recon.notMaintenance")}>{line.notMaintenance}</StatRow>
        <StatRow label={t("committee.recon.share")} detail={line.rowsImported === 0 ? undefined : t("committee.recon.share.detail", { n: line.postedAutomatically, d: line.rowsImported })}>
          {shareText(line.postedAutomatically, line.rowsImported)}
        </StatRow>
      </dl>
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
      <h3 className="pt-2 text-body font-semibold">{t("committee.recon.interventions")}</h3>
      <table className="w-full text-left text-body">
        <caption className="sr-only">{t("committee.recon.interventions.caption")}</caption>
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
    </section>
  );
}
