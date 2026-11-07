import { withPermission } from "@/server/auth/guard";
import { handleSetStatus } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** Staff move a complaint to in progress or mark it resolved. */
export const POST = withPermission("complaints:manage", (context) => handleSetStatus(context));
