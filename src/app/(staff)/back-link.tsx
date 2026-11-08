"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { t } from "@/lib/messages";

/** The pages that draw their own breadcrumb (it starts with a link to the staff home): the reconciliation workspace. */
const OWN_BREADCRUMB = /^\/staff\/reconciliation\/[^/]+/;

/** The banner of every staff page but the staff home: one link back to it (D188). On /staff itself there is nothing to go back to, so nothing is drawn. */
export function StaffBackLink() {
  const pathname = usePathname();
  if (pathname === "/staff" || OWN_BREADCRUMB.test(pathname)) return null;
  return (
    <header className="border-b border-hairline px-4">
      <nav aria-label={t("staff.nav.label")} className="mx-auto flex w-full max-w-7xl items-center">
        <Link href="/staff" aria-label={t("staff.nav.backLabel")} className="inline-flex min-h-12 items-center gap-2 text-body font-semibold text-accent">
          <ArrowLeftIcon />
          {t("staff.nav.home")}
        </Link>
      </nav>
    </header>
  );
}
