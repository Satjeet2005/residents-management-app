import { withPermission } from "@/server/auth/guard";
import { handleClose } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** The duty manager closes a safety complaint. */
export const POST = withPermission("complaints:duty_manager", (context) => handleClose(context));
