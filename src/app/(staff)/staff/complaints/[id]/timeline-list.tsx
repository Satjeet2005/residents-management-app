import { StatusTag } from "@/components/ui/status-tag";
import { t } from "@/lib/messages";
import { whenWords } from "@/lib/staff-complaints/time";
import type { TimelineLine } from "@/lib/staff-complaints/timeline";

/**
 * The full timeline, oldest first, internal events included. Every line says in words whether the resident sees it ("Visible to the resident") or only
 * staff do ("Internal"): the words carry the meaning, the tone only adds to them.
 */
export function TimelineList({ lines }: { lines: readonly TimelineLine[] }) {
  return (
    <ol className="border-t border-hairline">
      {lines.map((line) => (
        <li key={line.key} className="flex flex-col gap-1 border-b border-hairline py-3 text-body">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tnum text-ink-2">{whenWords(line.at)}</span>
            <StatusTag tone={line.visibility === "visible" ? "positive" : "neutral"}>{line.visibility === "visible" ? t("staffComplaints.mark.visible") : t("staffComplaints.mark.internal")}</StatusTag>
          </span>
          <span className="break-words font-semibold">{line.label}</span>
          <span className="text-caption text-ink-2">{line.who === null ? t("staffComplaints.timeline.bySystem") : t("staffComplaints.timeline.by", { name: line.who })}</span>
          {line.text !== null && <span className="whitespace-pre-line break-words">{line.text}</span>}
        </li>
      ))}
    </ol>
  );
}
