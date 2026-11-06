import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { isDemoMode } from "@/server/clock";
import { loadImportList } from "@/server/statements/ui-data";
import { ReconciliationHomeView } from "./home-view";

export const metadata = { title: "Bank reconciliation" };
export const dynamic = "force-dynamic";

/** Staff with payments:match: upload a statement and see the recent imports. Anyone else is sent away by requireUser. */
export default async function ReconciliationPage() {
  const user = await requireUser({ need: "payments:match", returnTo: "/staff/reconciliation" });
  const imports = await loadImportList({ db: defaultDeps().db, user });
  return <ReconciliationHomeView imports={imports} demo={isDemoMode()} />;
}
