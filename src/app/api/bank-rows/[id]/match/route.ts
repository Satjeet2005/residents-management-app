import { withPermission } from "@/server/auth/guard";
import { handleMatch } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** Staff match a queued row to a flat by hand (a large credit only asks for approval). */
export const POST = withPermission("payments:match", (context) => handleMatch(context));
