import { PhoneIcon, WarningIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button-link";
import type { SafetyCategory } from "@/domain/complaints/safety";
import { formatClockIst } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { telHref } from "@/lib/phone-link";
import type { HomeSafetyAlert } from "@/server/home/types";

/** The word in "Your <word> report", or null when there is no specific wording (the title then names no category). */
function categoryWord(category: SafetyCategory): string | null {
  switch (category) {
    case "FIRE":
      return t("safetyAlert.category.fire");
    case "GAS":
      return t("safetyAlert.category.gas");
    case "LIFT_STUCK":
      return t("safetyAlert.category.lift");
    case "SHOCK":
      return t("safetyAlert.category.shock");
    case "MEDICAL_VIOLENCE":
      return null;
  }
}

function sentTitle(category: SafetyCategory | null): string {
  const word = category === null ? null : categoryWord(category);
  return word === null ? t("safetyAlert.sentNoCategory") : t("safetyAlert.sent", { category: word });
}

/** The title and the line under it for each of the three states (design 1a, 1b, 1c). */
function wordsOf(alert: HomeSafetyAlert): { title: string; line: string | null; call: string } {
  switch (alert.state) {
    case "SENT":
      return {
        title: sentTitle(alert.category),
        line: t("safetyAlert.callNow"),
        call: t("safetyAlert.callDuty"),
      };
    case "SEEN":
      return { title: t("safetyAlert.seen"), line: alert.seenAt === null ? t("safetyAlert.callNow") : t("safetyAlert.seenAt", { time: formatClockIst(alert.seenAt) }), call: t("safetyAlert.callDuty") };
    case "NO_ANSWER": {
      const number = alert.callPhone?.trim() ?? "";
      return { title: t("safetyAlert.noAnswer"), line: number === "" ? null : t("safetyAlert.noAnswerCall", { number }), call: t("safetyAlert.callNumber", { number }) };
    }
  }
}

/**
 * The safety alert slot above the dues (D126). It is the one filled control of the Home: its Call button is a tel: link from the settings, and Pay
 * steps back to outlined while this is shown (D58). Without a number there is no link to nowhere; the alert says so in words.
 */
export function SafetyAlert({ alert }: { alert: HomeSafetyAlert }) {
  const words = wordsOf(alert);
  const href = telHref(alert.callPhone);
  return (
    <section role="alert" aria-label={words.title} className="flex flex-col gap-3 border-y-2 border-ink bg-paper-2 py-4">
      <h2 className="flex items-start gap-3 text-body font-semibold">
        <span aria-hidden="true" className="pt-0.5">
          <WarningIcon />
        </span>
        {words.title}
      </h2>
      {words.line !== null && <p className="text-body">{words.line}</p>}
      {href === null ? (
        <p className="text-body">{t("safetyAlert.noNumber")}</p>
      ) : (
        <ButtonLink href={href} large>
          <PhoneIcon />
          {words.call}
        </ButtonLink>
      )}
    </section>
  );
}
