import { cx } from "./cx";

export type TrackerState = "done" | "current" | "upcoming";
export type TrackerStep = { label: string; state: TrackerState };

const STATE_WORDS: Record<TrackerState, string> = { done: "Done: ", current: "Current: ", upcoming: "Next: " };

/** The step the person is on: the current one, else the first one not done, else the last. */
export function stepNumber(steps: readonly TrackerStep[]): number {
  const current = steps.findIndex((s) => s.state === "current");
  if (current !== -1) return current + 1;
  const upcoming = steps.findIndex((s) => s.state === "upcoming");
  return upcoming === -1 ? steps.length : upcoming + 1;
}

function Marker({ state }: { state: TrackerState }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-accent bg-paper text-accent">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      </span>
    );
  }
  if (state === "current") return <span className="block h-6 w-6 rounded-full border-[6px] border-accent bg-paper" aria-hidden="true" />;
  return <span className="block h-6 w-6 rounded-full border-2 border-control bg-paper" aria-hidden="true" />;
}

/**
 * Progress through three or four steps, such as "Payment received, Posted to your
 * account". A check is done, a thick ring is current, a hollow marker is
 * upcoming; the line after a done step is solid, after the others dashed. The
 * position is also text ("Step 2 of 4", above the steps unless the screen writes its own line) and the current step has
 * aria-current.
 */
export function Tracker({ steps, label = "Progress", showStepText = true }: { steps: readonly TrackerStep[]; label?: string; showStepText?: boolean }) {
  return (
    <div>
      {showStepText && (
        <p className="tnum text-caption text-ink-2">
          Step {stepNumber(steps)} of {steps.length}
        </p>
      )}
      <ol aria-label={label} className={cx("flex", showStepText && "mt-2")}>
        {steps.map((step, index) => (
          <li
            key={step.label}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cx(
              "relative flex min-w-0 flex-1 flex-col items-center px-1 text-center",
              index < steps.length - 1 &&
                "after:absolute after:left-1/2 after:top-3 after:w-full after:border-t-2 after:content-['']",
              index < steps.length - 1 && (step.state === "done" ? "after:border-solid after:border-accent" : "after:border-dashed after:border-control"),
            )}
          >
            <span className="relative z-10">
              <Marker state={step.state} />
            </span>
            <span className={cx("mt-2 min-h-10 break-words text-caption", step.state === "current" && "font-semibold")}>
              <span className="sr-only">{STATE_WORDS[step.state]}</span>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
