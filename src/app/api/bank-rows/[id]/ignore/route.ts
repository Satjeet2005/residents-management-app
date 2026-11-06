import { withPermission } from "@/server/auth/guard";
import { handleIgnore } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** Staff mark a queued credit as not a maintenance payment. */
export const POST = withPermission("payments:match", (context) => handleIgnore(context));
