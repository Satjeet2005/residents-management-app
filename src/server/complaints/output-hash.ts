import { createHash } from "node:crypto";

/** JSON with the keys of every object in sorted order, so equal values always give the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The SHA-256 (hex) of the canonical JSON of a value: the `output_hash` of a classification. */
export const outputHash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
