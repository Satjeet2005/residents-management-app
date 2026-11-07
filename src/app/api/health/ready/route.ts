import { publicRoute } from "@/server/auth/guard";
import { checkReadiness } from "@/server/health/readiness";

/** D112: a value-free report of what a deployment needs to sign someone in. 200 when ready, 503 when not. The guard adds no-store. */
export const GET = publicRoute(async ({ deps }) => {
  const report = await checkReadiness({ getDb: () => deps.db });
  return Response.json(report, { status: report.status === "ok" ? 200 : 503 });
});
