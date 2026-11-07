import { withPermission } from "@/server/auth/guard";
import { handleCategory } from "@/server/complaints/handlers";

export const runtime = "nodejs";

/** Staff correct the category. */
export const POST = withPermission("complaints:manage", (context) => handleCategory(context));
