import type { ReactNode } from "react";

/** One figure of a section: the label (and what it counts, in small print, and a goal mark when the metric has one) on the left, the figure right-aligned in tabular figures. */
export function StatRow({ label, detail, extra, children }: { label: string; detail?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="flex min-w-0 flex-col">
        <span className="text-body">{label}</span>
        {detail !== undefined && <span className="text-caption text-ink-2">{detail}</span>}
        {extra}
      </dt>
      <dd className="tnum text-right text-body font-semibold">{children}</dd>
    </div>
  );
}
