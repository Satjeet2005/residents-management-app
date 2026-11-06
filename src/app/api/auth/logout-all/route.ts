import { withPermission } from "@/server/auth/guard";
import { handleLogoutAll } from "@/server/auth/handlers";

export const runtime = "nodejs";

export const POST = withPermission("ANY_USER", handleLogoutAll);
