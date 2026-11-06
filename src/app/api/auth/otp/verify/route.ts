import { publicRoute } from "@/server/auth/guard";
import { handleOtpVerify } from "@/server/auth/handlers";

export const runtime = "nodejs";

export const POST = publicRoute(({ request, deps }) => handleOtpVerify(deps, request));
