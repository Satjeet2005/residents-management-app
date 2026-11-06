import { defaultDeps } from "@/server/auth/default-deps";
import { handleLogoutAll } from "@/server/auth/handlers";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleLogoutAll(defaultDeps(), request);
}
