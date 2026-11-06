import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/** Shown while the reconciliation start page loads: bars where the upload panel and the recent imports will be. No heading: the page has the only h1. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4">
      <p role="status" className="text-heading font-semibold">
        {t("recon.loading")}
      </p>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={3} />
      </div>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={4} />
      </div>
    </main>
  );
}
