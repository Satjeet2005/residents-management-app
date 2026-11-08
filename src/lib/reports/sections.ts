/** The five sections of the committee report, in page order. The headline cards are not sections and cannot be hidden. */
export const SECTION_IDS = ["money", "owed", "quality", "complaints", "bank"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The cookie that remembers the sections a person hid, on this device and browser: the hidden ids joined by commas. No personal data, no database. */
export const VIEW_COOKIE = "committee_view";
export const VIEW_COOKIE_MAX_BYTES = 80;
export const VIEW_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const isSectionId = (value: string): value is SectionId => (SECTION_IDS as readonly string[]).includes(value);

/**
 * The sections the cookie says are hidden. Anything that is not exactly what the app writes is IGNORED as a whole and every section is shown: a value over 80
 * bytes, an id outside the five, a repeated id, an empty id, or anything else (the value is never trusted, and never put in the page). An empty value is "none hidden".
 */
export function parseHiddenSections(raw: string | null | undefined): SectionId[] {
  if (raw === undefined || raw === null || raw === "") return [];
  if (new TextEncoder().encode(raw).length > VIEW_COOKIE_MAX_BYTES) return [];
  const ids = raw.split(",");
  if (!ids.every(isSectionId) || new Set(ids).size !== ids.length) return [];
  return ids;
}

/** The cookie value for the hidden sections, in page order (the same text whatever order they were chosen in). */
export const serializeHiddenSections = (hidden: readonly SectionId[]): string => SECTION_IDS.filter((id) => hidden.includes(id)).join(",");
