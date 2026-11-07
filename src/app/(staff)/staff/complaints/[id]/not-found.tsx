import Link from "next/link";
import { t } from "@/lib/messages";

/** A complaint address that matches no complaint (a missing one and a bad id look the same). */
export default function ComplaintNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-heading font-semibold">{t("staffComplaints.notFound.title")}</h1>
      <p className="text-body">{t("staffComplaints.notFound.body")}</p>
      <Link href="/staff/complaints" className="inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4">
        {t("staffComplaints.back")}
      </Link>
    </main>
  );
}
