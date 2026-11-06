import { defaultDeps } from "@/server/auth/default-deps";
import { handleLogout } from "@/server/auth/handlers";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleLogout(defaultDeps(), request);
}
