import { withPermission } from "@/server/auth/guard";
import { handleAcknowledge } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** The duty manager acknowledges a safety complaint. */
export const POST = withPermission("complaints:duty_manager", (context) => handleAcknowledge(context));
