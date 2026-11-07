import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/** Shown while the report is built: the month selector, the money line and the other blocks as plain bars. No heading: the page that replaces it has the only h1. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <p role="status" className="text-heading font-semibold">
        {t("committee.loading")}
      </p>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={2} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-control border border-hairline p-4">
          <Skeleton lines={5} />
        </div>
        <div className="rounded-control border border-hairline p-4">
          <Skeleton lines={5} />
        </div>
      </div>
    </main>
  );
}
