import { createHash } from "node:crypto";

/** Fixed, so the same seed key maps to the same UUID on every run and every machine. */
const NAMESPACE = "township-app/demo-seed/v1";

/**
 * A version-5-style UUID from SHA-256 of the namespace and the key: the first 16
 * bytes of the hash, with the version nibble set to 5 and the variant bits to 10.
 * Deterministic; two different keys collide only with probability about 2^-122.
 */
export function uuidFromKey(key: string): string {
  const bytes = createHash("sha256").update(`${NAMESPACE}\n${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
