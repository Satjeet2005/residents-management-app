import type { ReactNode } from "react";
import { cx } from "./cx";

export type StatusTone = "neutral" | "caution" | "positive";

const TONES: Record<StatusTone, string> = {
  neutral: "bg-paper-2 text-ink border-control",
  caution: "bg-paper text-caution border-caution",
  positive: "bg-paper text-accent border-accent",
};

/** A short status such as "Overdue" or "Paid". Always words; the colour and the optional icon only add to them. */
export function StatusTag({ tone = "neutral", icon, children }: { tone?: StatusTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx("inline-flex min-h-7 items-center gap-1 rounded-control border px-2 text-caption font-semibold", TONES[tone])}>
      {icon !== undefined && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
