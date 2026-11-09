import { istDateOf } from "@/domain/time/calendar";
import { formatDayLong } from "@/lib/format-date";
import type { DemoNoteState } from "@/lib/demo-note";
import { businessNow, isBusinessClockFrozen, isDemoMode } from "@/server/clock";

/** The note for the screens: null outside demo mode, otherwise the frozen business date as text, or null for the real date. */
export function demoNoteState(env: Readonly<Record<string, string | undefined>> = process.env): DemoNoteState | null {
  if (!isDemoMode(env)) return null;
  return { frozenOn: isBusinessClockFrozen(env) ? formatDayLong(istDateOf(businessNow(env))) : null };
}
