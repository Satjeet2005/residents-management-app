import Link from "next/link";
import { t } from "@/lib/messages";

/** An import address that matches no import. */
export default function ImportNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-heading font-semibold">{t("recon.notFound.title")}</h1>
      <p className="text-body">{t("recon.notFound.body")}</p>
      <Link href="/staff/reconciliation" className="inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4">
        {t("recon.ws.back")}
      </Link>
    </main>
  );
}
