import type { ReactNode } from "react";

/** One figure of a block: the label (and what it counts, in small print) on the left, the figure right-aligned in tabular figures. */
export function StatRow({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="flex min-w-0 flex-col">
        <span className="text-body">{label}</span>
        {detail !== undefined && <span className="text-caption text-ink-2">{detail}</span>}
      </dt>
      <dd className="tnum text-right text-body font-semibold">{children}</dd>
    </div>
  );
}
