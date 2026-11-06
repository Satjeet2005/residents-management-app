import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/** Shown while a resident page loads: plain bars where the dues, complaints and visitors will be. No shimmer, no spinner. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      {/* Not a heading: Next.js streams this fallback and the page into one document, which must keep a single h1. */}
      <p role="status" className="text-heading font-semibold">
        {t("home.loading")}
      </p>
      <div className="flex flex-col gap-3 rounded-control border border-hairline p-4">
        <Skeleton lines={3} />
      </div>
      <div className="flex flex-col gap-3 rounded-control border border-hairline p-4">
        <Skeleton lines={4} />
      </div>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={2} />
      </div>
    </main>
  );
}
