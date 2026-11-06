import { Money } from "@/components/ui/money";
import { formatDay } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { relationLabel } from "@/lib/reconciliation/labels";
import type { CandidateCard, FlatHit } from "@/lib/reconciliation/types";

const optionClass = "flex min-h-12 cursor-pointer items-start gap-3 rounded-control border-2 border-control p-3";

type Common = { name: string; selected: string | null; onChoose: (flatCode: string) => void; disabled: boolean };

/** One flat as a radio option: the whole box is the label, so the target is at least 48px and the gap between boxes is 8px. */
export function CandidateOption({ candidate, creditPaise, name, selected, onChoose, disabled }: Common & { candidate: CandidateCard; creditPaise: bigint }) {
  const oldest = candidate.openPositions[0];
  return (
    <li>
      <label className={optionClass}>
        <input type="radio" name={name} value={candidate.flatCode} checked={selected === candidate.flatCode} disabled={disabled} onChange={() => onChoose(candidate.flatCode)} className="mt-1 h-5 w-5 shrink-0" />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="tnum text-body font-semibold">{candidate.flatCode}</span>
          <span className="break-words text-body">{candidate.residents.length === 0 ? t("recon.candidate.noResidents") : t("recon.candidate.residents", { names: candidate.residents.join(", ") })}</span>
          {candidate.openPositions.length === 0 ? (
            <span className="text-body">{t("recon.relation.none")}</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {candidate.openPositions.map((position) => (
                <li key={position.billId} className="text-body">
                  {position.kind === "FEE_ONLY" ? t("recon.position.feeOnly", { date: formatDay(position.dueOn) }) : t("recon.position.bill", { date: formatDay(position.dueOn) })}
                  {", "}
                  <Money amount={BigInt(position.amountDuePaise)} size="strong" /> {t("recon.position.due")}
                </li>
              ))}
            </ul>
          )}
          {oldest !== undefined && <span className="text-body font-semibold">{relationLabel(candidate.amountRelation, creditPaise, BigInt(oldest.amountDuePaise))}</span>}
        </span>
      </label>
    </li>
  );
}

/** A search result as a radio option in the same group. */
export function HitOption({ hit, name, selected, onChoose, disabled }: Common & { hit: FlatHit }) {
  return (
    <li>
      <label className={optionClass}>
        <input type="radio" name={name} value={hit.flatCode} checked={selected === hit.flatCode} disabled={disabled} onChange={() => onChoose(hit.flatCode)} className="mt-1 h-5 w-5 shrink-0" />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="tnum text-body font-semibold">{hit.flatCode}</span>
          <span className="break-words text-body">{hit.residents.length === 0 ? t("recon.candidate.noResidents") : t("recon.candidate.residents", { names: hit.residents.join(", ") })}</span>
          <span className="text-body text-ink-2">{hit.openPositions === 1 ? t("recon.hit.oneOpen") : t("recon.hit.manyOpen", { n: hit.openPositions })}</span>
        </span>
      </label>
    </li>
  );
}
