"use client";

import { BlockError } from "@/components/ui/block-error";
import { t } from "@/lib/messages";

/** When the complaints cannot load: what happened, what it does not mean, and Try again. Never the error itself. */
export default function ComplaintsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("complaints.title")}</h1>
      <BlockError message={t("complaints.error.message")} consequence={t("complaints.error.consequence")} onRetry={reset} />
    </main>
  );
}
