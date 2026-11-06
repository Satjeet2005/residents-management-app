import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/** Shown while a workspace loads: the header, the summary bar, the tabs and the rows as plain bars. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <p role="status" className="text-heading font-semibold">
        {t("recon.ws.loading")}
      </p>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={2} />
      </div>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={3} />
      </div>
      <div className="rounded-control border border-hairline p-4">
        <Skeleton lines={5} />
      </div>
    </main>
  );
}
