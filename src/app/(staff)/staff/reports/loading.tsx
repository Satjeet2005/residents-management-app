import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/messages";

/**
 * Shown while the report is built, in the shape of the page: the four headline cards (one column, two from 768px, four from 1280px) and the five section
 * toggles (two columns from 1280px) as plain bars. No heading: the page that replaces it has the only h1.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <p role="status" className="text-heading font-semibold">
        {t("committee.loading")}
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-control border border-hairline p-4">
            <Skeleton lines={4} />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-control border border-hairline p-4">
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    </main>
  );
}
