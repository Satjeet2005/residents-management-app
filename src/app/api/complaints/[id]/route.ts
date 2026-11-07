import { withPermission } from "@/server/auth/guard";
import { handleGetOwn } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** A resident reads one complaint of their own flat. */
export const GET = withPermission("RESIDENT", (context) => handleGetOwn(context));
