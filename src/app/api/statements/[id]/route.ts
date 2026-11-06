import { withPermission } from "@/server/auth/guard";
import { handleSummary } from "@/server/statements/handlers";

export const runtime = "nodejs";

/** The counts of one import, read from the database. */
export const GET = withPermission("payments:match", (context) => handleSummary(context));
