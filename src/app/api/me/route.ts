import { withPermission } from "@/server/auth/guard";
import { buildMe } from "@/server/auth/me";

export const runtime = "nodejs";

export const GET = withPermission("ANY_USER", async ({ user, deps, now }) => Response.json(await buildMe(deps.db, user, now)));
