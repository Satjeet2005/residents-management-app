import { REASON_GROUPS, type ReasonGroup } from "@/domain/matching/reason-groups";
import { formatRupees } from "@/domain/money/money";
import { t } from "@/lib/messages";
import type { Lane } from "./types";

export const SORTS = ["largest", "oldest"] as const;
export type RowSort = (typeof SORTS)[number];
export const AMOUNTS = ["any", "high", "low"] as const;
export type AmountFilter = (typeof AMOUNTS)[number];
export const REASONS = ["any", ...REASON_GROUPS] as const;
export type ReasonFilter = (typeof REASONS)[number];

/** Sort, amount and reason as the address carries them: `?sort=largest|oldest`, `?amount=any|high|low`, `?reason=any|noflat|several|differs|low`. */
export type RowFilters = { sort: RowSort; amount: AmountFilter; reason: ReasonFilter };
export const DEFAULT_FILTERS: RowFilters = { sort: "largest", amount: "any", reason: "any" };

const pick = <T extends string>(allowed: readonly T[], value: string | string[] | undefined, fallback: T): T => {
  const text = Array.isArray(value) ? value[0] : value;
  return allowed.find((item) => item === text) ?? fallback;
};

/** The filters of an address. Only the allowlisted words count: anything else, a repeated key, an unknown word or a hostile string, is the default. */
export function parseFilters(query: Record<string, string | string[] | undefined>): RowFilters {
  return { sort: pick(SORTS, query.sort, "largest"), amount: pick(AMOUNTS, query.amount, "any"), reason: pick(REASONS, query.reason, "any") };
}

/** Does this lane have a reason filter? Only the lanes of rows that wait for a person (Needs you, Awaiting approval) carry stored reasons worth filtering by. */
export const reasonApplies = (lane: Lane): boolean => lane === "NEEDS_YOU" || lane === "AWAITING_APPROVAL";

/** The filters that really apply in a lane: a reason chosen on another lane is not applied where it does not apply. */
export const effectiveFilters = (filters: RowFilters, lane: Lane): RowFilters => (reasonApplies(lane) ? filters : { ...filters, reason: "any" });

export type ActiveFilter = { key: keyof RowFilters; name: string };

export const sortLabel = (sort: RowSort): string => (sort === "largest" ? t("recon.filter.sort.largest") : t("recon.filter.sort.oldest"));
export const reasonLabel = (reason: ReasonFilter): string => {
  switch (reason) {
    case "any":
      return t("recon.filter.reason.any");
    case "noflat":
      return t("recon.filter.reason.noflat");
    case "several":
      return t("recon.filter.reason.several");
    case "differs":
      return t("recon.filter.reason.differs");
    case "low":
      return t("recon.filter.reason.low");
  }
};
/** The amount choices in words; the threshold is the society's setting (D14), written here only through `formatRupees`. */
export const amountLabel = (amount: AmountFilter, thresholdPaise: bigint): string => {
  switch (amount) {
    case "any":
      return t("recon.filter.amount.any");
    case "high":
      return t("recon.filter.amount.high", { amount: formatRupees(thresholdPaise) });
    case "low":
      return t("recon.filter.amount.low", { amount: formatRupees(thresholdPaise) });
  }
};

/** The choices that differ from the default, as named chips: sort, then amount, then reason. */
export function activeFilters(filters: RowFilters, lane: Lane, thresholdPaise: bigint): ActiveFilter[] {
  const f = effectiveFilters(filters, lane);
  const out: ActiveFilter[] = [];
  if (f.sort !== DEFAULT_FILTERS.sort) out.push({ key: "sort", name: sortLabel(f.sort) });
  if (f.amount !== DEFAULT_FILTERS.amount) out.push({ key: "amount", name: amountLabel(f.amount, thresholdPaise) });
  if (f.reason !== DEFAULT_FILTERS.reason) out.push({ key: "reason", name: reasonLabel(f.reason) });
  return out;
}

/** Does a filter narrow the rows (amount or reason)? A different sort only reorders them. */
export const narrowsRows = (filters: RowFilters, lane: Lane): boolean => {
  const f = effectiveFilters(filters, lane);
  return f.amount !== "any" || f.reason !== "any";
};

export type { ReasonGroup };
