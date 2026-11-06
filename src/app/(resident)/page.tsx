import { redirect } from "next/navigation";
import { t } from "@/lib/messages";
import { requireUser } from "@/server/auth/current-user";

export const dynamic = "force-dynamic";

/** The resident Home. A staff member is sent to /staff. (The dues, complaints and visitors arrive with the Home view.) */
export default async function HomePage() {
  const user = await requireUser({ returnTo: "/" });
  if (user.role === "STAFF") redirect("/staff");
  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="text-heading font-semibold">{t("home.welcome", { name: user.name })}</h1>
    </main>
  );
}
