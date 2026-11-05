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
} as const;

export type OtpPolicy = {
  readonly digits: number;
  readonly ttlSeconds: number;
  readonly maxAttempts: number;
  readonly resendCooldownSeconds: number;
  readonly maxRequestsPerPhonePerHour: number;
  readonly maxRequestsPerIpPerHour: number;
};
