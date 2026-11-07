"use client";

import { BlockError } from "@/components/ui/block-error";
import { t } from "@/lib/messages";

/**
 * Shown when a reconciliation page cannot load its data (this covers the workspace too). It says what happened, that nothing was changed,
 * and offers Try again. It never shows the error itself: a message from the server or the database stays out of the page.
 */
export default function ReconciliationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("recon.title")}</h1>
      <BlockError message={t("recon.errorPage.message")} consequence={t("recon.errorPage.consequence")} reference={error.digest} onRetry={reset} />
    </main>
  );
}
