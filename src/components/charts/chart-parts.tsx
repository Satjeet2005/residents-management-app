import type { ReactNode } from "react";
import { t } from "@/lib/messages";
import { cx } from "@/components/ui/cx";

/** The data behind a chart, as a real table: a caption, a header row, and one row per plotted category with its header cell first. */
export type ChartTable = { caption: string; columns: readonly string[]; rows: readonly { header: string; cells: readonly string[] }[] };

/** The words of a chart: the visible caption, the title and the description (the takeaway, worked out from the data) that assistive technology reads, and the table. */
export type ChartText = { id: string; caption: string; title: string; description: string; table: ChartTable; /** The caption is read but not shown, when the card around the chart already says it. */ captionHidden?: boolean };

/** "Show as a table": the plotted values as text, at every width (the chart is a picture of this table). Native <details>, so it works without a script. */
export function TableToggle({ table }: { table: ChartTable }) {
  // A table of more than four columns cannot fit a phone without a sideways scroll: below 768px its rows are stacked, a header and one line per figure.
  const stacked = table.columns.length > 4;
  return (
    <details className="text-body">
      <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-accent underline underline-offset-4">{t("committee.chart.table")}</summary>
      {stacked && (
        <div className="tnum flex flex-col pb-2 md:hidden">
          <p className="pb-2 text-caption font-semibold">{table.caption}</p>
          <ul className="flex list-none flex-col p-0">
            {table.rows.map((row) => (
              <li key={row.header} className="flex flex-col gap-1 border-b border-hairline py-2">
                <span className="text-body font-semibold">{row.header}</span>
                <dl className="flex flex-col">
                  {table.columns.slice(1).map((column, index) => (
                    <div key={column} className="flex items-baseline justify-between gap-4">
                      <dt className="text-caption text-ink-2">{column}</dt>
                      <dd className="text-right text-caption">{row.cells[index]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={cx("overflow-x-auto pb-2", stacked && "hidden md:block")}>
        <table className="tnum w-full text-left text-caption">
          <caption className="pb-2 text-left font-semibold">{table.caption}</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              {table.columns.map((column, index) => (
                <th key={column} scope="col" className={cx("py-2 font-semibold", index === 0 ? "pr-4" : "pl-4 text-right")}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.header} className="border-b border-hairline">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {row.header}
                </th>
                {row.cells.map((cell, index) => (
                  <td key={`${row.header}-${index}`} className="py-2 pl-4 text-right">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** A chart's frame: a <figure> with its <figcaption>, the drawing, and the table of its values. */
export function ChartFigure({ text, children }: { text: ChartText; children: ReactNode }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption className={cx("text-body font-semibold", text.captionHidden === true && "sr-only")}>{text.caption}</figcaption>
      {children}
      <TableToggle table={text.table} />
    </figure>
  );
}

/** The <svg> of a chart: an image (role="img") named by its <title> and described by its <desc>. It is drawn in its own units and scales to the width it is given (never up
 * to blur text: the viewBox is no wider than the narrowest place the chart is shown). It holds nothing to tap, hover or focus. */
export function ChartSvg({ text, width, height, children }: { text: ChartText; width: number; height: number; children: ReactNode }) {
  return (
    <svg role="img" aria-labelledby={`${text.id}-title ${text.id}-desc`} viewBox={`0 0 ${width} ${height}`} className="tnum block h-auto w-full" fontFamily="inherit">
      <title id={`${text.id}-title`}>{text.title}</title>
      <desc id={`${text.id}-desc`}>{text.description}</desc>
      {children}
    </svg>
  );
}

/** A diagonal hatch for the second series of a stacked chart, so it differs from the first by pattern and not by colour. */
export function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="8" height="8" className="fill-paper" />
      <line x1="0" y1="0" x2="0" y2="8" strokeWidth={2} className="stroke-ink" />
    </pattern>
  );
}

/** Where the points of a series are drawn: runs of consecutive values joined by a line, a run of one as a dot, and a gap (null) breaks the line. */
export function runsOf<T extends { y: number | null }>(points: readonly T[]): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** A dotted fill, lighter than a solid bar, for a figure that is still growing (a month younger than 20 days): it is told apart by pattern and by the word "so far", not by colour. */
export function Dots({ id }: { id: string }) {
  return (
    <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" className="fill-paper" />
      <circle cx="4" cy="4" r="1.75" className="fill-accent" />
    </pattern>
  );
}
