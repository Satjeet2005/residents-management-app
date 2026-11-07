import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { loadRaiseFormData } from "@/server/complaints/page-data";
import { NewComplaintForm } from "./new-complaint-form";

export const metadata = { title: "Raise a complaint" };
export const dynamic = "force-dynamic";

/** The raise form. Only a resident. The duty manager's number comes from the settings, for the call link shown after "Yes". */
export default async function NewComplaintPage() {
  await requireUser({ need: "RESIDENT", returnTo: "/complaints/new" });
  const { dutyManagerPhone } = await loadRaiseFormData({ db: defaultDeps().db });
  return <NewComplaintForm dutyManagerPhone={dutyManagerPhone} />;
}
