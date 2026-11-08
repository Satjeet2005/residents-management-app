import type { ReactNode } from "react";
import { ChevronIcon } from "@/components/icons";
import type { SectionId } from "@/lib/reports/sections";

/**
 * One section of the report as a native <details>: the title and a one-sentence headline computed from the data are always visible in the <summary> (a 48px tap
 * target), the detail opens on demand. ALL the content is in the server-rendered HTML whether it is open or not. `defaultOpen` marks the sections that open from
 * 768px (a tiny client component applies it, only to sections the server did not already decide); `forceOpen` is the server's decision (a drill-down was asked for).
 */
export function ReportSection({ id, title, period, headline, defaultOpen, forceOpen, children }: { id: SectionId; title: string; period: string; headline: string; defaultOpen: boolean; forceOpen: boolean; children: ReactNode }) {
  return (
    <details id={id} data-section={id} data-default-open={defaultOpen && !forceOpen ? "true" : "false"} open={forceOpen} className="min-w-0 rounded-control border border-hairline">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 p-4">
        <span className="flex min-w-0 flex-col">
          <h2 className="text-title font-semibold">{title}</h2>
          <span className="text-body text-ink-2">{headline}</span>
        </span>
        <span aria-hidden="true" data-chevron="" className="shrink-0">
          <ChevronIcon size={24} />
        </span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-hairline p-4">
        <p className="text-body text-ink-2">{period}</p>
        {children}
      </div>
    </details>
  );
}
