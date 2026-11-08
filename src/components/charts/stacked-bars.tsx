import { CHART_TEXT } from "./chart-tokens";
import { type ChartText, ChartFigure, ChartSvg, Dots, Hatch } from "./chart-parts";
import { MAX_BARS } from "./horizontal-bars";

const WIDTH = 560;
const HEIGHT = 280;
const LEFT = 8;
const RIGHT = 128;
const TOP = 36;
const BOTTOM = 36;

export type StackColumn = {
  label: string;
  /** For drawing only: the heights are in any one unit (paise as a number). Both zero with `hasData` false is a gap. */
  collected: number;
  outstanding: number;
  hasData: boolean;
  /** The collected share written above the column ("82%"; "79% so far" for a month still growing). */
  percentText: string;
  /** The month is younger than the measuring age: its collected part is drawn dotted, never solid. */
  partial?: boolean;
};

/**
 * C1 (from 768px): one column per month, collected at the bottom (solid) and outstanding on top (hatched), the collected share written above each column and the
 * two series NAMED at the right of the last column that has data (no legend to match by colour). A month without bills is a gap written "No data". At most
 * seven columns.
 */
export function StackedBars({ text, columns, labels }: { text: ChartText; columns: readonly StackColumn[]; labels: { collected: string; outstanding: string } }) {
  if (columns.length > MAX_BARS) throw new RangeError(`A bar chart has at most ${MAX_BARS} bars, got ${columns.length}`);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const slot = plotWidth / columns.length;
  const barWidth = Math.min(56, slot * 0.6);
  const tallest = Math.max(...columns.map((c) => c.collected + c.outstanding), 1);
  const hatch = `${text.id}-hatch`;
  const dots = `${text.id}-dots`;
  const lastWithData = columns.findLastIndex((c) => c.hasData);
  const base = TOP + plotHeight;
  return (
    <ChartFigure text={text}>
      <ChartSvg text={text} width={WIDTH} height={HEIGHT}>
        <defs>
          <Hatch id={hatch} />
          <Dots id={dots} />
        </defs>
        <line x1={LEFT} x2={LEFT + plotWidth} y1={base} y2={base} strokeWidth={2} className="stroke-ink" />
        {columns.map((column, index) => {
          const centre = LEFT + slot * index + slot / 2;
          const collectedHeight = (column.collected * plotHeight) / tallest;
          const outstandingHeight = (column.outstanding * plotHeight) / tallest;
          return (
            <g key={column.label}>
              {column.hasData ? (
                <>
                  <rect
                    x={centre - barWidth / 2}
                    y={base - collectedHeight}
                    width={barWidth}
                    height={collectedHeight}
                    strokeWidth={2}
                    strokeDasharray={column.partial === true ? "5 3" : undefined}
                    fill={column.partial === true ? `url(#${dots})` : undefined}
                    className={column.partial === true ? "stroke-accent" : "fill-accent stroke-accent"}
                  />
                  <rect x={centre - barWidth / 2} y={base - collectedHeight - outstandingHeight} width={barWidth} height={outstandingHeight} strokeWidth={2} fill={`url(#${hatch})`} className="stroke-ink" />
                  <text x={centre} y={base - collectedHeight - outstandingHeight - 8} fontSize={CHART_TEXT} fontWeight={600} textAnchor="middle" className="fill-ink">
                    {column.percentText}
                  </text>
                </>
              ) : (
                <text x={centre} y={base - 8} fontSize={CHART_TEXT} textAnchor="middle" className="fill-ink-2">
                  {column.percentText}
                </text>
              )}
              <text x={centre} y={HEIGHT - 10} fontSize={CHART_TEXT} textAnchor="middle" className="fill-ink">
                {column.label}
              </text>
            </g>
          );
        })}
        {lastWithData >= 0 && (
          <g>
            <text x={LEFT + plotWidth + 12} y={base - (columns[lastWithData].collected * plotHeight) / tallest / 2 + 5} fontSize={CHART_TEXT} fontWeight={600} className="fill-ink">
              {labels.collected}
            </text>
            <text x={LEFT + plotWidth + 12} y={base - (columns[lastWithData].collected * plotHeight) / tallest - (columns[lastWithData].outstanding * plotHeight) / tallest / 2 + 5} fontSize={CHART_TEXT} fontWeight={600} className="fill-ink">
              {labels.outstanding}
            </text>
          </g>
        )}
      </ChartSvg>
    </ChartFigure>
  );
}
