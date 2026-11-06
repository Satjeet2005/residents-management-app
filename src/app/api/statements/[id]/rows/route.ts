import { withPermission } from "@/server/auth/guard";
import { handleListRows } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** One lane of one import, biggest amount first, a page at a time (keyset). */
export const GET = withPermission("payments:match", (context) => handleListRows(context));
