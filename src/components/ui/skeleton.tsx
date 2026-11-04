const BAR_WIDTHS = ["w-full", "w-5/6", "w-2/3", "w-3/4"];

/** Placeholder bars while something loads. Plain bars, no shimmer, so there is nothing to switch off for reduced motion. */
export function Skeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} aria-hidden="true" className={`h-4 rounded-control bg-paper-2 ${BAR_WIDTHS[i % BAR_WIDTHS.length]}`} />
      ))}
    </div>
  );
}
