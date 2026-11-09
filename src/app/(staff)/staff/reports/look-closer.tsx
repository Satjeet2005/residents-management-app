import Link from "next/link";
import { ChevronIcon } from "@/components/icons";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { SECTIONS, type SectionSlug, sectionHref } from "@/lib/reports/sections";
import type { CommitteeReport } from "@/server/reports/report-data";

/**
 * "Look closer": ONE container with four rows separated by hairlines, one per section page. Each row is a single link at least 56px tall: the title in bold, a one-line
 * headline worked out from the section's own numbers (new information, not a repeat of a card), and a chevron. The headline is part of the link's name.
 */
export function LookCloser({ report, period }: { report: CommitteeReport; period: CalendarDate }) {
  const titles: Record<SectionSlug, string> = { collections: t("committee.look.collections"), dues: t("committee.look.dues"), complaints: t("committee.look.complaints"), bank: t("committee.look.bank") };
  return (
    <section aria-labelledby="committee-look-closer" className="flex flex-col gap-2">
      <h2 id="committee-look-closer" className="text-title font-semibold">
        {t("committee.look.heading")}
      </h2>
      <ul className="flex list-none flex-col rounded-control border border-hairline px-1 py-0">
        {SECTIONS.map((section) => (
          <li key={section.slug} className="border-b border-hairline py-1 last:border-b-0">
            <Link href={sectionHref(section.slug, period)} className="flex min-h-14 items-center justify-between gap-4 px-2">
              <span className="flex min-w-0 flex-col">
                <span className="text-body font-semibold">{titles[section.slug]}</span>
                <span className="text-caption text-ink-2">{report.headlines[section.headline]}</span>
              </span>
              <span aria-hidden="true" className="shrink-0">
                <ChevronIcon size={24} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
