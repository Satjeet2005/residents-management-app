import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/messages";

/** The frame of the staff pages: a banner with one link home, then the page. It checks nobody: each page asks requireUser for itself. */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-hairline px-4">
        <nav aria-label={t("staff.nav.label")} className="mx-auto flex w-full max-w-7xl items-center">
          <Link href="/staff" className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4">
            {t("staff.nav.home")}
          </Link>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
