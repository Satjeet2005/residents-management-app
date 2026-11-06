import { t } from "@/lib/messages";
import type { ImportListEntry } from "@/lib/reconciliation/types";
import { ImportsTable } from "./imports-table";
import { UploadPanel } from "./upload-panel";

/** The reconciliation start page: upload a statement, then the recent imports. */
export function ReconciliationHomeView({ imports, demo }: { imports: readonly ImportListEntry[]; demo: boolean }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("recon.title")}</h1>
      <UploadPanel demo={demo} />
      <section aria-labelledby="recon-imports" className="flex flex-col gap-3">
        <h2 id="recon-imports" className="text-title font-semibold">
          {t("recon.imports.title")}
        </h2>
        <ImportsTable imports={imports} />
      </section>
    </main>
  );
}
