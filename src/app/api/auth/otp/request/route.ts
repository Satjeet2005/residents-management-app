import { publicRoute } from "@/server/auth/guard";
import { handleOtpRequest } from "@/server/auth/handlers";

export const runtime = "nodejs";

export const POST = publicRoute(({ request, deps }) => handleOtpRequest(deps, request));
