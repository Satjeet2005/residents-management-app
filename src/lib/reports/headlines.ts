import { formatRupeesShort } from "@/domain/money/short";
import type { Ageing } from "@/domain/reports/age";
import type { ComplaintMetrics } from "@/domain/reports/complaints";
import type { CollectionQuality, MoneyLine } from "@/domain/reports/money-line";
import type { ReconciliationLine } from "@/domain/reports/reconciliation";
import { percent } from "@/domain/reports/stats";
import { t } from "@/lib/messages";
import { countText, percentText } from "./cards";

export type SectionHeadlines = { money: string; owed: string; quality: string; complaints: string; bank: string };

/**
 * The one sentence under each section's title, computed from the same numbers as the section: "₹1.49 crore collected of ₹1.81 crore", "817 flats owe
 * ₹60.6 lakh", "70% paid on time, 88% of paid bills", "1,603 raised, 85% replied in time", "24 of 106 rows posted automatically". Money is in the short form;
 * a share with nothing to measure says "No data" and a section with nothing to count says so in words.
 */
export function sectionHeadlines(input: { money: MoneyLine | null; ageing: Ageing; quality: CollectionQuality | null; complaints: ComplaintMetrics; reconciliation: ReconciliationLine }): SectionHeadlines {
  const { money, ageing, quality, complaints, reconciliation } = input;
  const owed = ageing.total;
  return {
    money: money === null ? t("committee.headline.moneyNone") : t("committee.headline.money", { collected: formatRupeesShort(money.collectedPaise), billed: formatRupeesShort(money.billedPaise) }),
    owed:
      owed.bills === 0
        ? t("committee.headline.owedNone")
        : owed.flats === 1
          ? t("committee.headline.owedOne", { amount: formatRupeesShort(owed.amountDuePaise) })
          : t("committee.headline.owedMany", { n: countText(owed.flats), amount: formatRupeesShort(owed.amountDuePaise) }),
    quality:
      quality === null
        ? t("committee.headline.moneyNone")
        : quality.due === 0 && quality.paid === 0
          ? t("committee.headline.qualityNone")
          : t("committee.headline.quality", { headline: percentText(percent(quality.dueOnTime, quality.due)), ofPaid: percentText(percent(quality.paidOnTime, quality.paid)) }),
    complaints:
      complaints.raised === 0
        ? t("committee.headline.complaintsNone")
        : t("committee.headline.complaints", { raised: countText(complaints.raised), share: percentText(percent(complaints.firstReply.withinSla, complaints.firstReply.decided)) }),
    bank:
      reconciliation.imports === 0
        ? t("committee.headline.bankNone")
        : t("committee.headline.bank", { n: countText(reconciliation.postedAutomatically), d: countText(reconciliation.rowsImported) }),
  };
}
