import { withPermission } from "@/server/auth/guard";
import { handleApprove } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** A second person approves a request. */
export const POST = withPermission("payments:approve", (context) => handleApprove(context));
