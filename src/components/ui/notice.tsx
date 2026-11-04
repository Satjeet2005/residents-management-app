import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A banner. "status" is polite news such as "You are offline"; "alert" interrupts
 * and is for something that needs attention. Both are always words.
 */
export function Notice({ kind = "status", children }: { kind?: "status" | "alert"; children: ReactNode }) {
  return (
    <div
      role={kind === "alert" ? "alert" : "status"}
      className={cx("rounded-control border px-4 py-3 text-body", kind === "alert" ? "border-2 border-caution bg-paper text-ink" : "border-control bg-paper-2 text-ink")}
    >
      {children}
    </div>
  );
}
