import { CATEGORY_CODES, type CategoryCode, MODEL_URGENCIES, type ModelUrgency } from "@/domain/complaints/taxonomy";

/** The two answers the classifier needs, as ArmResult holds them. */
export type SystemOneDistributions = {
  categories: { label: CategoryCode; probability: number }[];
  urgencies: { label: ModelUrgency; probability: number }[];
};

/** The request body of POST /v1/systemone (docs.typesafe.ai/api/system-one, read 2026-11-07): the model (only when set, D144), the state, and named questions. */
export type SystemOneRequest = {
  model?: string;
  state: string;
  questions: { category: ChoiceQuestion; urgency: ChoiceQuestion };
};
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };

const CATEGORY_CRITERIA: Record<CategoryCode, string> = {
  PLUMBING: "Water problems: a leak, a blocked drain, a tap, a pipe, no water, a toilet or bathroom fixture.",
  ELECTRICAL: "Electrical problems: a light, a fan, a switch, a socket, a power cut, wiring, a meter.",
  HOUSEKEEPING: "Cleaning and waste: garbage not collected, dirty stairs or corridors, sweeping, pests, gardening.",
  LIFT: "The lift or elevator: slow, noisy, out of service, a button or door that does not work.",
  OTHER: "Anything else: noise, parking, security, pets, neighbours, or something that fits none of the above.",
};

const URGENCY_CRITERIA: Record<ModelUrgency, string> = {
  HIGH: "Needs action today: a service is fully out, or the problem is getting worse quickly.",
  NORMAL: "An ordinary problem that should be fixed in the next day or two.",
  LOW: "A small matter, a suggestion, or something that can wait several days.",
};

/**
 * The request for one complaint (D140). TWO questions in one call: the category over exactly the five codes, and the urgency over HIGH, NORMAL and
 * LOW (never CRITICAL: only the safety rules produce it). The body holds ONLY the model, the de-identified text and the questions: no user id, no flat.
 * Without a model the `model` key is left out entirely, not empty and not null, and the provider chooses its default (D144).
 */
export function buildRequest(deidentifiedText: string, model?: string): SystemOneRequest {
  return {
    ...(model === undefined ? {} : { model }),
    state: deidentifiedText,
    questions: {
      category: { type: "choice", instructions: "Which kind of problem does this complaint from a resident of a housing society describe?", criteria: { ...CATEGORY_CRITERIA } },
      urgency: { type: "choice", instructions: "How urgent is this complaint from a resident of a housing society?", criteria: { ...URGENCY_CRITERIA } },
    },
  };
}

const SUM_TOLERANCE = 0.001;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One choice answer as a distribution over exactly the allowed labels, in their order, or null. The provider documents that `probabilities` sums to 1
 * (docs.typesafe.ai/primitives/choice, 2026-11-07), so a distribution that does not is rejected, never renormalised.
 */
function distribution<L extends string>(answer: unknown, allowed: readonly L[]): { label: L; probability: number }[] | null {
  if (!isRecord(answer) || answer.type !== "choice" || !isRecord(answer.probabilities)) return null;
  const probabilities = answer.probabilities;
  const keys = Object.keys(probabilities);
  if (keys.length !== allowed.length || !keys.every((key) => (allowed as readonly string[]).includes(key))) return null;
  if (answer.choice !== undefined && !(typeof answer.choice === "string" && (allowed as readonly string[]).includes(answer.choice))) return null;
  let sum = 0;
  const out: { label: L; probability: number }[] = [];
  for (const label of allowed) {
    const probability = probabilities[label];
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    sum += probability;
    out.push({ label, probability });
  }
  return Math.abs(sum - 1) <= SUM_TOLERANCE ? out : null;
}

/** The two distributions of a response body, or null when anything is missing or invalid (a failure for the breaker). */
export function parseResponse(json: unknown): SystemOneDistributions | null {
  if (!isRecord(json) || !isRecord(json.answers)) return null;
  const categories = distribution(json.answers.category, CATEGORY_CODES);
  const urgencies = distribution(json.answers.urgency, MODEL_URGENCIES);
  return categories === null || urgencies === null ? null : { categories, urgencies };
}
