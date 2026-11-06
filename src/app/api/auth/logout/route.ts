import { publicRoute } from "@/server/auth/guard";
import { handleLogout } from "@/server/auth/handlers";

export const runtime = "nodejs";

// Public on purpose: logging out is idempotent (204 with or without a session) and always clears the cookie.
export const POST = publicRoute(({ request, deps }) => handleLogout(deps, request));
