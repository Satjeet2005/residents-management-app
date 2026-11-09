import type { ReactNode } from "react";
import { Support } from "@/components/committee/support";

/** A value never wraps: the spaces between a number and its unit are non-breaking ("1 h 34 min" stays on one line). */
const keepTogether = (value: ReactNode): ReactNode => (typeof value === "string" ? value.replace(/ /g, " ") : value);

/**
 * One figure of a section: the label on the left (a number-bearing sub-line under it only when it carries a count, and a goal line when the metric has one), the
 * value right-aligned in tabular figures on ONE line. `figure` names the registry id of the figure, so the page's expander must define it.
 */
export function StatRow({ label, detail, extra, figure, children }: { label: string; detail?: string; extra?: ReactNode; figure: string; children: ReactNode }) {
  return (
    <div data-figure={figure} className="flex items-baseline justify-between gap-4 py-2">
      <dt className="flex min-w-0 flex-col">
        <span className="text-body">{label}</span>
        {detail !== undefined && <Support as="span">{detail}</Support>}
        {extra}
      </dt>
      <dd className="tnum shrink-0 whitespace-nowrap text-right text-body font-semibold">{keepTogether(children)}</dd>
    </div>
  );
}
