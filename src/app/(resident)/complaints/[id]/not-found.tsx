import Link from "next/link";
import { t } from "@/lib/messages";

/** The same page for a complaint that is missing and one that belongs to another flat: nothing says which. */
export default function ComplaintNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 p-4">
      <h1 className="text-heading font-semibold">{t("complaintDetail.notFound.title")}</h1>
      <p className="text-body">{t("complaintDetail.notFound.body")}</p>
      <Link href="/complaints" className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4">
        {t("complaintDetail.notFound.link")}
      </Link>
    </main>
  );
}
