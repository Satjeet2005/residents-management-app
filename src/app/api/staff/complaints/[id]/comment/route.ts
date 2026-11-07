import { withPermission } from "@/server/auth/guard";
import { handleComment } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** Staff add a comment or an internal note. */
export const POST = withPermission("complaints:manage", (context) => handleComment(context));
