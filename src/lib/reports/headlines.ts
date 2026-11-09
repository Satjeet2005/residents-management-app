import { formatRupeesShort } from "@/domain/money/short";
import type { Ageing } from "@/domain/reports/age";
import type { ComplaintMetrics } from "@/domain/reports/complaints";
import type { CollectionQuality, MoneyLine } from "@/domain/reports/money-line";
import type { ReconciliationLine } from "@/domain/reports/reconciliation";
import { percent } from "@/domain/reports/stats";
import { t } from "@/lib/messages";
import { countText, percentText } from "./cards";
import { daysText } from "./share";

export type SectionHeadlines = { money: string; owed: string; quality: string; complaints: string; bank: string };

/**
 * The one sentence under each section's title on a phone, worked out from the section's own numbers, and always NEW information that the cards above do not say
 * (D179): "Billed ₹1.81 crore · 472 flats still to pay", "₹7.5 lakh is over 90 days", "Half of paid bills are paid within 3 days · 88% of paid bills were on time", "1,603 raised, 85%
 * answered in time", "44 bank entries need a person". Money is in the short form; a share with nothing to measure says "No data" and a section with nothing to
 * count says so in words.
 */
export function sectionHeadlines(input: { money: MoneyLine | null; ageing: Ageing; quality: CollectionQuality | null; complaints: ComplaintMetrics; reconciliation: ReconciliationLine }): SectionHeadlines {
  const { money, ageing, quality, complaints, reconciliation } = input;
  const owed = ageing.total;
  const over90 = ageing.buckets.find((b) => b.bucket === "OVER_90");
  return {
    money:
      money === null
        ? t("committee.headline.moneyNone")
        : money.flatsOutstanding === 0
          ? t("committee.headline.moneyPaid", { billed: formatRupeesShort(money.billedPaise) })
          : t("committee.headline.money", { billed: formatRupeesShort(money.billedPaise), n: countText(money.flatsOutstanding) }),
    owed:
      owed.bills === 0
        ? t("committee.headline.owedNone")
        : over90 === undefined || over90.bills === 0
          ? t("committee.headline.owedNoneOver90")
          : t("committee.headline.owedOver90", { amount: formatRupeesShort(over90.amountDuePaise) }),
    quality:
      quality === null
        ? t("committee.headline.moneyNone")
        : quality.paid === 0
          ? t("committee.headline.qualityNone")
          : t("committee.headline.quality", { days: daysText(quality.medianDaysToPay), ofPaid: percentText(percent(quality.paidOnTime, quality.paid)) }),
    complaints:
      complaints.raised === 0
        ? t("committee.headline.complaintsNone")
        : t("committee.headline.complaints", { raised: countText(complaints.raised), share: percentText(percent(complaints.firstReply.withinSla, complaints.firstReply.decided)) }),
    bank:
      reconciliation.imports === 0
        ? t("committee.headline.bankNone")
        : reconciliation.waitingForPerson === 0
          ? t("committee.headline.bankNoneWaiting")
          : reconciliation.waitingForPerson === 1
            ? t("committee.headline.bankOne")
            : t("committee.headline.bankMany", { n: countText(reconciliation.waitingForPerson) }),
  };
}
