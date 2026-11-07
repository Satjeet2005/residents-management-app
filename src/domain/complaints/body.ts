import { normalizeComplaintText, detectScript } from "./text";

export const COMPLAINT_BODY_MAX = 2000;

/** Every control character except the line feed and the tab (a complaint may have lines). */
const CONTROL = /[\p{Cc}]/gu;

/**
 * The text of a complaint as it is stored: control characters removed (except a line feed and a tab), trimmed, and nothing else changed, so the
 * words are exactly what the resident wrote. Null when it is blank or longer than 2,000 characters (counted as characters, not UTF-16 units).
 */
export function prepareComplaintBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.replace(CONTROL, (c) => (c === "\n" || c === "\t" ? c : "")).trim();
  if (body === "") return null;
  return Array.from(body).length <= COMPLAINT_BODY_MAX ? body : null;
}

/** The text stored when someone declares danger and writes nothing (D121). Fixed: nothing is invented from the report. */
export const NO_DESCRIPTION = "(no description)";

/** True for a text that is empty once control characters and spaces are removed. A value that is not text is not blank, it is invalid. */
export const isBlankBody = (raw: unknown): boolean => typeof raw === "string" && raw.replace(CONTROL, "").trim() === "";

/** The script label stored in `complaints.language`: LATIN, DEVANAGARI or MIXED. A text with no letters (digits, an emoji) has none. */
export function scriptLabel(body: string): "LATIN" | "DEVANAGARI" | "MIXED" | null {
  const { script } = detectScript(body);
  return script === "LATIN" || script === "DEVANAGARI" || script === "MIXED" ? script : null;
}

/** The key by which a resident's repeat is recognised: the text as the classifier reads it, in lower case. */
export const repeatKey = (body: string): string => normalizeComplaintText(body).toLowerCase();
