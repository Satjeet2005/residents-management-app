import { Money } from "@/components/ui/money";
import { formatDayYear } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { railLabel, reasonSentence } from "@/lib/reconciliation/labels";
import type { ReviewData } from "@/lib/reconciliation/types";

const orNone = (value: string | null): string => value ?? t("recon.fact.none");

/** The bank's own facts about the row, with the narration in full, and why the matcher left it to a person (the stored reasons, in plain English). */
export function ReviewFacts({ review }: { review: ReviewData }) {
  return (
    <>
      <section aria-labelledby="recon-facts" className="flex flex-col gap-2">
        <h3 id="recon-facts" className="text-title font-semibold">
          {t("recon.panel.facts")}
        </h3>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-body">
          <dt className="text-ink-2">{t("recon.fact.date")}</dt>
          <dd className="tnum">{formatDayYear(review.txnDate)}</dd>
          <dt className="text-ink-2">{t("recon.fact.amount")}</dt>
          <dd>
            <Money amount={BigInt(review.creditPaise)} size="strong" />
          </dd>
          <dt className="text-ink-2">{t("recon.fact.narration")}</dt>
          <dd className="break-words">{review.narration}</dd>
          <dt className="text-ink-2">{t("recon.fact.rail")}</dt>
          <dd>{railLabel(review.rail)}</dd>
          <dt className="text-ink-2">{t("recon.fact.reference")}</dt>
          <dd className="tnum break-words">{orNone(review.reference)}</dd>
          <dt className="text-ink-2">{t("recon.fact.payer")}</dt>
          <dd className="break-words">{orNone(review.payerName)}</dd>
          <dt className="text-ink-2">{t("recon.fact.upi")}</dt>
          <dd className="break-words">{orNone(review.upiId)}</dd>
        </dl>
      </section>
      {review.reasons.length > 0 && (
        <section aria-labelledby="recon-why" className="flex flex-col gap-2">
          <h3 id="recon-why" className="text-title font-semibold">
            {t("recon.panel.why")}
          </h3>
          <ul className="flex flex-col gap-1 text-body">
            {review.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{reasonSentence(reason)}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
