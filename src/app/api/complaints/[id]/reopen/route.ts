import { withPermission } from "@/server/auth/guard";
import { handleReopen } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** The resident says it is not fixed, with a reason. */
export const POST = withPermission("RESIDENT", (context) => handleReopen(context));
