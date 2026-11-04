import { dayStartInstant } from "@/domain/time/calendar";
import type { DemoComplaint } from "@/domain/seed/complaint-types";
import { defaultDataset } from "./default-dataset";

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** An India Standard Time clock time on `date`, in epoch milliseconds. */
export const ist = (date: string, hour: number, minute = 0): number => dayStartInstant(date) + hour * HOUR + minute * MINUTE;

export const dataset = defaultDataset();

export function flatOf(code: string) {
  const flat = dataset.flats.find((f) => f.code === code);
  if (flat === undefined) throw new Error(`flat ${code} is missing`);
  return flat;
}

export function userNamed(name: string) {
  const user = dataset.users.find((u) => u.name === name);
  if (user === undefined) throw new Error(`user ${name} is missing`);
  return user;
}

export const complaintsOf = (code: string): DemoComplaint[] => dataset.complaints.filter((c) => c.flatKey === flatOf(code).key);

export const share = (part: number, whole: number): number => (100 * part) / whole;

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
