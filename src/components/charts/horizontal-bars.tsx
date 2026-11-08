import { CHART_TEXT } from "./chart-tokens";
import { type ChartText, ChartFigure, ChartSvg, Hatch } from "./chart-parts";

export const MAX_BARS = 7;
const WIDTH = 320;
const ROW = 54;
const BAR = 14;

export type BarRow = {
  label: string;
  /** The value written at the end of the label, already formatted (short money form). */
  valueText: string;
  /** The length of the bar, 0 or more, in the unit of the other rows; the longest row is the full width. */
  value: number;
  /** "warning" draws the bar hatched in the caution colour: pattern and colour, with the label as the meaning. */
  emphasis?: "warning";
};

/**
 * M3 and M4: each row is a label, its value written at the right and a bar under them, scaled to the longest row (`scaleMax` sets another full length, for
 * percents). At most seven rows (a longer list is not a bar chart: the call throws). Every bar is labelled in text; there is nothing to tap, so a link to a
 * drill-down sits next to the chart, never inside it.
 */
export function HorizontalBars({ text, rows, scaleMax }: { text: ChartText; rows: readonly BarRow[]; scaleMax?: number }) {
  if (rows.length > MAX_BARS) throw new RangeError(`A bar chart has at most ${MAX_BARS} bars, got ${rows.length}`);
  const full = scaleMax ?? Math.max(...rows.map((r) => r.value), 0);
  const hatch = `${text.id}-hatch`;
  return (
    <ChartFigure text={text}>
      <ChartSvg text={text} width={WIDTH} height={rows.length * ROW}>
        <defs>
          <Hatch id={hatch} />
        </defs>
        {rows.map((row, index) => {
          const top = index * ROW;
          const length = full === 0 ? 0 : (Math.max(0, row.value) * (WIDTH - 4)) / full;
          return (
            <g key={row.label}>
              <text x={2} y={top + 18} fontSize={CHART_TEXT} className="fill-ink">
                {row.label}
              </text>
              <text x={WIDTH - 2} y={top + 18} fontSize={CHART_TEXT} fontWeight={600} textAnchor="end" className="fill-ink">
                {row.valueText}
              </text>
              <rect x={2} y={top + 26} width={WIDTH - 4} height={BAR} rx={3} strokeWidth={2} className="fill-paper stroke-hairline" />
              {length > 0 && (
                <rect x={2} y={top + 26} width={Math.max(length, 4)} height={BAR} rx={3} strokeWidth={2} fill={row.emphasis === "warning" ? `url(#${hatch})` : undefined} className={row.emphasis === "warning" ? "stroke-caution" : "fill-accent stroke-accent"} />
              )}
            </g>
          );
        })}
      </ChartSvg>
    </ChartFigure>
  );
}
