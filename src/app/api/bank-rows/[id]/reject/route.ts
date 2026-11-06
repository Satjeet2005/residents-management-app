import { withPermission } from "@/server/auth/guard";
import { handleReject } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** A second person turns a request down. */
export const POST = withPermission("payments:approve", (context) => handleReject(context));
