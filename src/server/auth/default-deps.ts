import { getDb } from "../db";
import type { AuthRouteDeps } from "./handlers";
import { mockOtpSender } from "./otp-service";

/** The real dependencies of the running server: the database, the mock sender (D3) and the clock. */
export function defaultDeps(): AuthRouteDeps {
  return { db: getDb(), sender: mockOtpSender, now: () => Date.now() };
}
