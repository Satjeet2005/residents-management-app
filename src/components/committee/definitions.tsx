import { t } from "@/lib/messages";
import type { DefinitionLine } from "@/lib/reports/figures";

/**
 * The ONE expander of a committee page: "What do these mean?", closed, opening in place, with one short line for every figure of the page. The lines come from
 * the figure registry (src/lib/reports/figures.ts), so a figure cannot be shown without its line. Nothing is drawn when the page shows no figure.
 */
export function Definitions({ lines }: { lines: readonly DefinitionLine[] }) {
  if (lines.length === 0) return null;
  return (
    <details data-definitions="" className="border-t border-hairline pt-2">
      <summary className="flex min-h-12 cursor-pointer items-center text-body font-semibold text-accent underline underline-offset-4">{t("committee.definitions.summary")}</summary>
      <ul className="flex list-none flex-col gap-2 p-0 text-body text-ink-2">
        {lines.map((line) => (
          <li key={line.id} data-def-for={line.id}>
            {line.text}
          </li>
        ))}
      </ul>
    </details>
  );
}
