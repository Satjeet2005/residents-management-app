"use client";

import { BlockError } from "@/components/ui/block-error";
import { t } from "@/lib/messages";

/** The last stop for a page that failed (D135): it says so, gives the reference to quote, and offers Try again. It never shows the error itself. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <BlockError message={t("error.title")} reference={error.digest} onRetry={reset} />
    </main>
  );
}
