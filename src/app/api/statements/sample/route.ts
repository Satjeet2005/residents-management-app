import { withPermission } from "@/server/auth/guard";
import { handleImportSample } from "@/server/statements/handlers";

export const runtime = "nodejs";

/** Demo only: imports the committed sample statement. A 404 unless DEMO_MODE is exactly "true". */
export const POST = withPermission("payments:match", (context) => handleImportSample(context));
