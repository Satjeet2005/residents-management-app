import { defaultDeps } from "@/server/auth/default-deps";
import { handleOtpRequest } from "@/server/auth/handlers";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleOtpRequest(defaultDeps(), request);
}
