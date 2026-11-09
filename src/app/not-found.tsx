import { ButtonLink } from "@/components/ui/button-link";
import { t } from "@/lib/messages";

export const metadata = { title: "Page not found" };

/**
 * The page for an address that does not exist (A-006), and for a demo checkout that is not the person's. It fetches nothing and looks nobody up, so it
 * cannot fail for a logged-out visitor, a resident or staff. One filled link goes to "/", which sends each role to its own home page.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-start gap-4 p-4">
      <h1 className="text-heading font-semibold">{t("notFound.title")}</h1>
      <p className="text-body">{t("notFound.body")}</p>
      <ButtonLink href="/">{t("notFound.home")}</ButtonLink>
    </main>
  );
}
