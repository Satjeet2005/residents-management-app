/** The confirmed login defaults (docs/auth-design.md). Policies are in seconds; the rules in this module work in epoch milliseconds. */
export const authPolicy = {
  otp: {
    digits: 6,
    ttlSeconds: 300,
    maxAttempts: 5,
    resendCooldownSeconds: 30,
    maxRequestsPerPhonePerHour: 5,
    maxRequestsPerIpPerHour: 30,
  },
  session: {
    /** D74: the NIST single-factor ceiling is 30 days overall; a short idle limit means a device left alone opens for less time. */
    RESIDENT: { idleSeconds: 14 * 86400, absoluteSeconds: 30 * 86400 },
    /** D75: 30 minutes idle and 12 hours overall, one login per working day. Staff can move money. */
    STAFF: { idleSeconds: 1800, absoluteSeconds: 43200 },
  },
  touchThrottleSeconds: 60,
} as const;

export type Role = "RESIDENT" | "STAFF";

export type SessionLimits = { readonly idleSeconds: number; readonly absoluteSeconds: number };

export type SessionPolicy = {
  readonly session: Record<Role, SessionLimits>;
  readonly touchThrottleSeconds: number;
};

export type OtpPolicy = {
  readonly digits: number;
  readonly ttlSeconds: number;
  readonly maxAttempts: number;
  readonly resendCooldownSeconds: number;
  readonly maxRequestsPerPhonePerHour: number;
  readonly maxRequestsPerIpPerHour: number;
};
