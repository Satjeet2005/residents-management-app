import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { dateWords } from "@/lib/reports/period";

/**
 * "About these numbers", at the very bottom: the as-of date, one plain sentence defining every metric of the page (including the denominators of Paid on time and
 * the rules of the SLA), and, only when the committee_goals setting is not set, the note that the built-in targets are shown.
 */
export function AboutBlock({ asOf, goalsAreDefaults }: { asOf: CalendarDate; goalsAreDefaults: boolean }) {
  return (
    <section aria-labelledby="committee-about" className="flex flex-col gap-3 border-t border-hairline pt-6">
      <h2 id="committee-about" className="text-title font-semibold">
        {t("committee.about.heading")}
      </h2>
      <p className="text-body">{t("committee.about.asOf", { date: dateWords(asOf) })}</p>
      <ul className="flex flex-col gap-2 text-body text-ink-2">
        <li>{t("committee.about.money")}</li>
        <li>{t("committee.about.fees")}</li>
        <li>{t("committee.about.owed")}</li>
        <li>{t("committee.about.onTime")}</li>
        <li>{t("committee.about.ofPaid")}</li>
        <li>{t("committee.about.median")}</li>
        <li>{t("committee.about.curve")}</li>
        <li>{t("committee.about.sla")}</li>
        <li>{t("committee.about.complaints")}</li>
        <li>{t("committee.about.safety")}</li>
        <li>{t("committee.about.bank")}</li>
      </ul>
      {goalsAreDefaults && <p className="text-body font-semibold">{t("committee.goals.default")}</p>}
    </section>
  );
}
