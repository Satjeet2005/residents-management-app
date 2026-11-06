import { withPermission } from "@/server/auth/guard";
import { handleInitiate } from "@/server/payments/handlers";

export const runtime = "nodejs";

/** A resident taps Pay: the amount is locked and an attempt is created (or the existing one is returned). */
export const POST = withPermission("RESIDENT", (context) => handleInitiate(context));
