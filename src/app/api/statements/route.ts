import { withPermission } from "@/server/auth/guard";
import { handleImport } from "@/server/statements/handlers";
import { handleListImports } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** Staff with `payments:match` upload a bank statement CSV; the answer is the summary of what was decided. */
export const POST = withPermission("payments:match", (context) => handleImport(context));

/** The latest imports, newest first. */
export const GET = withPermission("payments:match", (context) => handleListImports(context));
