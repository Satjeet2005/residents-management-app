import { defaultDeps } from "@/server/auth/default-deps";
import { handleOtpVerify } from "@/server/auth/handlers";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleOtpVerify(defaultDeps(), request);
}
