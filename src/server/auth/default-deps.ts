import { getDb } from "../db";
import type { AuthRouteDeps } from "./handlers";
import { mockOtpSender } from "./otp-service";

/**
 * The real dependencies of the running server: the database, the mock sender (D3) and the clock. The database is opened when `db`
 * is first read, so a route that does not need it (the readiness check) can still answer when DATABASE_URL is missing.
 */
export function defaultDeps(): AuthRouteDeps {
  return { get db() { return getDb(); }, sender: mockOtpSender, now: () => Date.now() };
}
