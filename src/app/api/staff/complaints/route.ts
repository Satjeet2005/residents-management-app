import { withPermission } from "@/server/auth/guard";
import { handleBoard } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** One lane of the staff board. */
export const GET = withPermission("complaints:manage", (context) => handleBoard(context));
