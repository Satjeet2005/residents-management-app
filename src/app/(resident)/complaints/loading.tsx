import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/** Plain bars where the complaints will be. Not a heading: the page that replaces it has the only h1. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <p role="status" className="text-heading font-semibold">
        {t("complaints.loading")}
      </p>
      <div className="flex flex-col gap-3 rounded-control border border-hairline p-4">
        <Skeleton lines={4} />
      </div>
    </main>
  );
}
