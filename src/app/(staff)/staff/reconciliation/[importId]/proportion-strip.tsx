import { cx } from "@/components/ui/cx";
import { laneShares } from "@/lib/reconciliation/summary";
import type { Lane } from "@/lib/reconciliation/types";

/** How each lane looks in the strip. The strip is decoration: the selector under it carries the words and the numbers. */
const SWATCH: Record<Lane, string> = {
  NEEDS_YOU: "bg-caution",
  AWAITING_APPROVAL: "bg-paper-2",
  MATCHED: "bg-accent",
  NOT_MAINTENANCE: "bg-hairline",
};

/** A thin (8px) strip of the four lane counts directly above the selector: no text, no legend, hidden from assistive technology (D189). */
export function ProportionStrip({ laneCounts }: { laneCounts: Record<Lane, number> }) {
  return (
    <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-control border border-ink">
      {laneShares(laneCounts)
        .filter((share) => share.width > 0)
        .map((share) => (
          <div key={share.lane} style={{ width: `${share.width}%` }} className={cx("h-full border-r border-ink", SWATCH[share.lane])} />
        ))}
    </div>
  );
}
