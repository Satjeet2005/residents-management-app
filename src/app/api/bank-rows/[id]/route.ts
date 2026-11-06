import { withPermission } from "@/server/auth/guard";
import { handleReview } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** The review of one bank row: the row, the matcher's reasons and the candidate flats with their open positions. */
export const GET = withPermission("payments:match", (context) => handleReview(context));
