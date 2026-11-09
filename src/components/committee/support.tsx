import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * Every secondary line of a committee page is a `<Support>`: it carries `data-support`, which is how the text budget counts it (src/lib/reports/text-budget.ts).
 * `takeaway` marks the ONE sentence a block may carry, which the budget also limits to 12 words. A `span` is for a line inside a label.
 */
export function Support({ as = "p", takeaway = false, small = false, figure, className, children }: { as?: "p" | "span" | "li"; takeaway?: boolean; /** 14px instead of 16px, for the lines inside a card. */ small?: boolean; /** The registry id of the figure this line states, when it is one. */ figure?: string; className?: string; children: ReactNode }) {
  const Tag = as;
  return (
    <Tag data-support="" data-figure={figure} data-takeaway={takeaway ? "" : undefined} className={cx(small ? "text-caption" : "text-body", takeaway ? "text-ink" : "text-ink-2", className)}>
      {children}
    </Tag>
  );
}
