import { withPermission } from "@/server/auth/guard";
import { handleConfirm } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** The resident says it is fixed. */
export const POST = withPermission("RESIDENT", (context) => handleConfirm(context));
