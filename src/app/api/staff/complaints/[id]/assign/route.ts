import { withPermission } from "@/server/auth/guard";
import { handleAssign } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** Staff assign a complaint. */
export const POST = withPermission("complaints:manage", (context) => handleAssign(context));
