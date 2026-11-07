import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/** Shown while the board loads: the tabs and the rows as plain bars. It has no heading: the page that replaces it has the only h1. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <p role="status" className="text-heading font-semibold">
        {t("staffComplaints.loading")}
      </p>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={2} />
      </div>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={5} />
      </div>
    </main>
  );
}
