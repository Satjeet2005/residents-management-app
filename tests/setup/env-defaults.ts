/**
 * Test-only defaults for secrets, applied ONLY WHEN THE VARIABLE IS UNSET (D128). CI has no .env, so a test must not rely on a developer's file for
 * these. Every other variable is left alone (DEMO_MODE stays unset unless a test sets it). A test about a MISSING or short secret removes or
 * overrides the variable itself and restores it (vi.stubEnv / vi.unstubAllEnvs). This file is referenced only by the vitest configs, so it can
 * never be part of a production build.
 */
const TEST_DEFAULTS: Readonly<Record<string, string>> = {
  OTP_PEPPER: "test-only-otp-pepper-not-a-secret-000001",
  PAYMENT_WEBHOOK_SECRET: "test-only-webhook-secret-not-real-000001",
};

for (const [name, value] of Object.entries(TEST_DEFAULTS)) {
  if (process.env[name] === undefined) process.env[name] = value;
}

/**
 * `git commit` runs the pre-commit hook with GIT_DIR and GIT_INDEX_FILE set (absolute paths when the commit is made in a linked worktree). Tests that
 * make their own scratch repositories (scan-secrets, doc-reference and submission-zip tests) would then run `git init`, `git config` and `git add`
 * against the REAL repository: its index gets junk files and its shared config gets a test user and `core.bare`. Every GIT_* variable is removed here.
 */
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}

export {};
