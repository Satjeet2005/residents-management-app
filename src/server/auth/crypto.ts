import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MIN_PEPPER_LENGTH = 32;
/** The placeholder in .env.example: long enough to pass a length check, so it is named and refused in production. */
const PLACEHOLDER_PREFIX = "replace-with";

/**
 * The secret mixed into every one-time-code and address hash. It fails closed: in production a missing,
 * short (under 32 characters) or placeholder pepper throws at first use, so nothing is hashed or stored.
 * Elsewhere any non-empty value is accepted, which keeps local runs and tests simple.
 * The value is never logged and never put in an error message.
 */
function pepper(): string {
  const value = process.env.OTP_PEPPER ?? "";
  if (value === "") throw new Error("OTP_PEPPER is not set");
  if (process.env.NODE_ENV === "production" && (value.length < MIN_PEPPER_LENGTH || value.startsWith(PLACEHOLDER_PREFIX))) {
    throw new Error(`OTP_PEPPER must be at least ${MIN_PEPPER_LENGTH} characters and not the placeholder in production`);
  }
  return value;
}

const hmac = (message: string): string => createHmac("sha256", pepper()).update(message).digest("hex");

/** HMAC-SHA256 of `phone:code` with the pepper, in hex. A stolen table cannot be brute-forced without the pepper. */
export function codeHash(phone: string, code: string): string {
  return hmac(`${phone}:${code}`);
}

/** HMAC-SHA256 of `ip:address` with the pepper, in hex. Stored in place of the address. */
export function ipHash(ip: string): string {
  return hmac(`ip:${ip}`);
}

/** Compares two hex digests in constant time. Digests of different lengths are never equal. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 32 random bytes, base64url: 256 bits, so it cannot be guessed. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 of the token, in hex. Only this is stored: a database leak does not give working sessions. */
export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Random bytes for otpFromRandom. */
export const randomBytesFor = (n: number): Uint8Array => new Uint8Array(randomBytes(n));
