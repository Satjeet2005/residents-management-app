/** Where the bar is drawn: a value or goal outside 0 to 100 is clamped for DRAWING only; the words keep the real figure. */
export const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * A bullet-style bar: a thin track, a solid fill to the value and, when there is a goal, a vertical tick across the track at the goal. It carries no text: the
 * card around it prints the figures, and `label` is the whole sentence for assistive technology ("70 percent. Goal 90 percent. 20 points short."). The fill is the
 * accent and the tick is ink, so the goal is told apart by shape and position, not by colour. Without `goal` it is a plain progress bar.
 * `direction` is "higher" when more is better and "lower" for a limit; the tick is drawn at the same place either way, and the card words say which side is good.
 */
export function GoalBar({ value, goal, label }: { value: number | null; goal?: number; direction?: "higher" | "lower"; label: string }) {
  const fill = value === null ? 0 : clampPercent(value);
  return (
    <div role="img" aria-label={label} className="relative flex h-5 w-full items-center">
      <div className="h-3 w-full overflow-hidden rounded-control border border-hairline bg-paper">
        <div data-part="fill" className="h-full bg-accent" style={{ width: `${fill}%` }} />
      </div>
      {goal !== undefined && <div data-part="tick" className="absolute h-5 w-0.5 bg-ink" style={{ left: `calc(${clampPercent(goal)}% - 1px)` }} />}
    </div>
  );
}
