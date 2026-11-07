const MIN_SECRET_LENGTH = 32;
/** The placeholder prefix of .env.example: long enough to pass a length check, so it is named and refused in production. */
const PLACEHOLDER_PREFIX = "replace-with";

/** The production rule for a secret (the OTP pepper, the webhook secret): set, at least 32 characters, and not the placeholder. */
export function isProductionGradeSecret(value: string | undefined): boolean {
  return value !== undefined && value.length >= MIN_SECRET_LENGTH && !value.startsWith(PLACEHOLDER_PREFIX);
}

export { MIN_SECRET_LENGTH };
