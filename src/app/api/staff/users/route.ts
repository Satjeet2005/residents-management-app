import { withPermission } from "@/server/auth/guard";
import { handleStaffUsers } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** The people a complaint may be assigned to. */
export const GET = withPermission("complaints:manage", (context) => handleStaffUsers(context));
