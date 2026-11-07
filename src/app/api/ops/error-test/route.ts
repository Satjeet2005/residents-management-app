import { publicRoute } from "@/server/auth/guard";
import { createErrorTestHandler } from "@/server/ops/error-test";

const handle = createErrorTestHandler();

/** D135: stores one test event and returns its reference, only with the right x-ops-token; a plain 404 otherwise, and always when OPS_TEST_TOKEN is not set. */
export const GET = publicRoute(({ request, deps }) => handle(request, deps.db));
