import { CheckIcon } from "@/components/icons";
import { DoubleRule } from "@/components/ui/rules";
import { Notice } from "@/components/ui/notice";
import { cx } from "@/components/ui/cx";
import { t } from "@/lib/messages";
import { type SegmentKey, accountedLine, summarySegments } from "@/lib/reconciliation/summary";
import type { SummaryCounts } from "@/lib/reconciliation/types";

/** How each segment looks. Colour and pattern only add to the label and the number printed beside it, they never carry the meaning. */
const SWATCH: Record<SegmentKey, string> = {
  AUTO: "bg-accent border-accent",
  MANUAL: "bg-paper border-accent",
  NEEDS_YOU: "bg-caution border-caution",
  AWAITING: "bg-paper-2 border-ink",
  NOT_MAINTENANCE: "bg-hairline border-hairline",
  ALREADY: "bg-paper border-dashed border-control",
};

/**
 * The summary of an import: a segmented bar, the same numbers in words under it (never colour alone), a double rule, and the
 * accounted line. The line says "All N rows accounted for" with a check ONLY when the flag read back from the database is true;
 * otherwise a caution says not to post from this import.
 */
export function SummaryBar({ counts }: { counts: SummaryCounts }) {
  const segments = summarySegments(counts);
  const line = accountedLine(counts);
  return (
    <section aria-labelledby="recon-summary" className="flex flex-col gap-3">
      <h2 id="recon-summary" className="sr-only">
        {t("recon.bar.title")}
      </h2>
      <div aria-hidden="true" className="flex h-4 w-full overflow-hidden rounded-control border border-ink">
        {segments
          .filter((s) => s.width > 0)
          .map((s) => (
            <div key={s.key} style={{ width: `${s.width}%` }} className={cx("h-full border-r", SWATCH[s.key])} />
          ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-body">
            <span aria-hidden="true" className={cx("h-4 w-4 shrink-0 rounded-control border-2", SWATCH[s.key])} />
            <span>{s.label}</span>
            <span className="tnum font-semibold">{s.count}</span>
          </li>
        ))}
      </ul>
      <DoubleRule />
      {line.ok ? (
        <p className="flex items-center gap-2 text-body font-semibold">
          <CheckIcon size={20} />
          {line.text}
        </p>
      ) : (
        <Notice kind="alert">{line.text}</Notice>
      )}
    </section>
  );
}
