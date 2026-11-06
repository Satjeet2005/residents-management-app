/** The complaint categories of the society (the seeded `complaint_categories` codes). */
export const CATEGORY_CODES = ["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

/** How urgent a complaint is, most urgent first. */
export const URGENCIES = ["CRITICAL", "HIGH", "NORMAL", "LOW"] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * The urgencies a model may answer with. CRITICAL is missing on purpose: it is produced ONLY by the safety rules (D9, D73), so a model
 * can never raise a complaint to CRITICAL, and a model that says CRITICAL is refused.
 */
export const MODEL_URGENCIES = ["HIGH", "NORMAL", "LOW"] as const;
export type ModelUrgency = (typeof MODEL_URGENCIES)[number];

export const isCategoryCode = (value: unknown): value is CategoryCode => typeof value === "string" && (CATEGORY_CODES as readonly string[]).includes(value);
export const isUrgency = (value: unknown): value is Urgency => typeof value === "string" && (URGENCIES as readonly string[]).includes(value);
export const isModelUrgency = (value: unknown): value is ModelUrgency => typeof value === "string" && (MODEL_URGENCIES as readonly string[]).includes(value);

/** Rank of an urgency: a larger number is more urgent. */
export const urgencyRank = (urgency: Urgency): number => URGENCIES.length - URGENCIES.indexOf(urgency);

/** The more urgent of two urgencies. */
export const higherUrgency = (a: Urgency, b: Urgency): Urgency => (urgencyRank(a) >= urgencyRank(b) ? a : b);
