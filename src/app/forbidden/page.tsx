import { ButtonLink } from "@/components/ui/button-link";
import { t } from "@/lib/messages";

export const metadata = { title: "No access" };

/** Where requireUser sends someone whose role does not allow a page. Public, so it needs no session. */
export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-start gap-4 p-4">
      <h1 className="text-heading font-semibold">{t("forbidden.title")}</h1>
      <p className="text-body">{t("forbidden.body")}</p>
      <ButtonLink href="/" variant="outlined">
        {t("forbidden.home")}
      </ButtonLink>
    </main>
  );
}
