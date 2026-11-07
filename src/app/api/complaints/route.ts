import { withPermission } from "@/server/auth/guard";
import { handleCreate, handleListOwn } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** A resident raises a complaint. */
export const POST = withPermission("RESIDENT", (context) => handleCreate(context));

/** A resident lists the complaints of their own flat. */
export const GET = withPermission("RESIDENT", (context) => handleListOwn(context));
