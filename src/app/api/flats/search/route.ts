import { withPermission } from "@/server/auth/guard";
import { handleSearchFlats } from "@/server/statements/reconciliation-handlers";

export const runtime = "nodejs";

/** Flats by code prefix or resident name token, at most 10, for a person matching a row by hand. */
export const GET = withPermission("payments:match", (context) => handleSearchFlats(context));
