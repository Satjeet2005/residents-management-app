import { publicRoute } from "@/server/auth/guard";
import { handleWebhook } from "@/server/payments/handlers";

export const runtime = "nodejs";

/** The payment gateway reports a result. No session: the HMAC signature in the headers is the authentication. */
export const POST = publicRoute((context) => handleWebhook(context));
