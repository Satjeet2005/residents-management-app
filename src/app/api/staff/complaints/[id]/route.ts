import { withPermission } from "@/server/auth/guard";
import { handleStaffGet } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** One complaint with its full timeline and classification history. */
export const GET = withPermission("complaints:manage", (context) => handleStaffGet(context));
