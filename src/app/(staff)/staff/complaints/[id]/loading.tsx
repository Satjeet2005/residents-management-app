import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/** Shown while one complaint loads: the facts, the timeline and the panel as plain bars. No heading: the page that replaces it has the only h1. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <p role="status" className="text-heading font-semibold">
        {t("staffComplaints.loadingOne")}
      </p>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={3} />
      </div>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={5} />
      </div>
    </main>
  );
}
