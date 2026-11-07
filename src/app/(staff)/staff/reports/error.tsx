"use client";

import { BlockError } from "@/components/ui/block-error";
import { t } from "@/lib/messages";

/**
 * Shown when the report cannot load its data. It says what happened, that nothing was changed (the report only reads), and offers Try again. It never shows the
 * error itself: a message from the server or the database stays out of the page.
 */
export default function ReportError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("committee.title")}</h1>
      <BlockError message={t("committee.errorPage.message")} consequence={t("committee.errorPage.consequence")} onRetry={reset} />
    </main>
  );
}
