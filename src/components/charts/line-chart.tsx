import { CHART_STROKE, CHART_TEXT } from "./chart-tokens";
import { type ChartText, ChartFigure, ChartSvg, runsOf } from "./chart-parts";

export const MAX_SERIES = 3;
const WIDTH = 560;
const HEIGHT = 300;
/** The data points of a chart with value labels start this far from the axes, so a label at the first point is clear of the axis text. */
const INSET = 28;
/** The room for a second line under the last tick, which names a part-finished last point. */
const PARTIAL_ROOM = 18;
const LEFT = 52;
const RIGHT = 84;
const TOP = 24;
const BOTTOM = 56;
/** The width of one character of a series name in 14px semibold, to tell whether the name fits to the right of the last point. */
const NAME_CHAR = 8;

export type LineSeries = {
  label: string;
  /** x in the chart's own unit (a day, a week number); y 0 to 100 or null for a gap. */
  points: readonly { x: number; y: number | null }[];
  /** A dash pattern, so a second series differs by more than colour. Undefined is a solid line. */
  dash?: string;
  /** A dot on every point (for a series of few points). */
  dots?: boolean;
  /** The value of every point is written in a row above the plot, over the point (a series without it is named, with its last value, beside its last point). */
  valueLabels?: boolean;
  /** The point at this index is not final (a week still going): it is drawn as a hollow ring and `partialLabel` is written under its tick. */
  partialIndex?: number;
  partialLabel?: string;
};

/**
 * The name of a series with its last value, written beside its last point: to the RIGHT of the point when there is room inside the plot (so the line never runs under
 * its own label), else right-aligned under the point (or above it when the point is near the bottom).
 */
function SeriesEnd({ series, last, right, base }: { series: LineSeries; last: { x: number; y: number | null; value: number | null }; right: number; base: number }) {
  const label = `${series.label} ${last.value}%`;
  const y = last.y as number;
  if (last.x + 10 + label.length * NAME_CHAR <= right) {
    return (
      <text x={last.x + 10} y={y + 5} fontSize={CHART_TEXT} fontWeight={600} className="fill-ink">
        {label}
      </text>
    );
  }
  return (
    <text x={last.x} y={y + 28 < base ? y + 28 : y - 10} fontSize={CHART_TEXT} fontWeight={600} textAnchor="end" className="fill-ink">
      {label}
    </text>
  );
}

/**
 * C3 and C4 (from 768px): up to three lines from 0 to 100 percent with a labelled y axis, a few labelled x ticks, an optional goal line (dashed and drawn behind the data, written at its right end OUTSIDE the plot so no data can cross the words),
 * an optional vertical marker (dotted, written at its top, the due day) and every series NAMED at its last point. Gaps break the line. No legend, no hover, no tap.
 */
export function LineChart({
  text,
  series,
  xMax,
  xTicks,
  xLabel,
  goal,
  marker,
}: {
  text: ChartText;
  series: readonly LineSeries[];
  xMax: number;
  xTicks: readonly { x: number; label: string }[];
  xLabel: string;
  goal: { percent: number; label: string } | null;
  marker: { x: number; label: string } | null;
}) {
  if (series.length > MAX_SERIES) throw new RangeError(`A line chart has at most ${MAX_SERIES} lines, got ${series.length}`);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const inset = series.some((s) => s.valueLabels === true) ? INSET : 0;
  const partial = series.find((s) => s.partialIndex !== undefined && s.partialLabel !== undefined && s.partialIndex === s.points.length - 1);
  const height = HEIGHT + (partial === undefined ? 0 : PARTIAL_ROOM);
  const x = (value: number) => LEFT + (xMax === 0 ? plotWidth / 2 : inset + (value * (plotWidth - 2 * inset)) / xMax);
  const y = (value: number) => TOP + plotHeight - (Math.max(0, Math.min(100, value)) * plotHeight) / 100;
  const base = TOP + plotHeight;
  return (
    <ChartFigure text={text}>
      <ChartSvg text={text} width={WIDTH} height={height}>
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={LEFT + plotWidth} y1={y(tick)} y2={y(tick)} strokeWidth={CHART_STROKE} className={tick === 0 ? "stroke-ink" : "stroke-hairline"} />
            <text x={LEFT - 8} y={y(tick) + 5} fontSize={CHART_TEXT} textAnchor="end" className="fill-ink-2">
              {tick}%
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={tick.label} x={x(tick.x)} y={base + 22} fontSize={CHART_TEXT} textAnchor="middle" className="fill-ink-2">
            {tick.label}
          </text>
        ))}
        {partial !== undefined && partial.partialLabel !== undefined && (
          <text x={x(xMax) + 24} y={base + 41} fontSize={CHART_TEXT} fontWeight={600} textAnchor="end" className="fill-ink">
            {partial.partialLabel}
          </text>
        )}
        <text x={LEFT + plotWidth / 2} y={height - 8} fontSize={CHART_TEXT} textAnchor="middle" className="fill-ink-2">
          {xLabel}
        </text>
        {marker !== null && (
          <g>
            <line x1={x(marker.x)} x2={x(marker.x)} y1={TOP} y2={base} strokeWidth={CHART_STROKE} strokeDasharray="2 4" strokeLinecap="round" className="stroke-caution" />
            <text x={x(marker.x) + 6} y={TOP + 14} fontSize={CHART_TEXT} fontWeight={600} className="fill-caution">
              {marker.label}
            </text>
          </g>
        )}
        {goal !== null && (
          <g>
            <line x1={LEFT} x2={LEFT + plotWidth} y1={y(goal.percent)} y2={y(goal.percent)} strokeWidth={CHART_STROKE} strokeDasharray="8 5" className="stroke-ink-2" />
            <text x={LEFT + plotWidth + 8} y={y(goal.percent) + 5} fontSize={CHART_TEXT} className="fill-ink-2">
              {goal.label}
            </text>
          </g>
        )}
        {series.map((s) => {
          const drawn = s.points.map((p) => ({ x: x(p.x), y: p.y === null ? null : y(p.y), value: p.y }));
          const last = drawn.findLast((p) => p.y !== null);
          return (
            <g key={s.label}>
              {runsOf(drawn).map((run) =>
                run.length === 1 ? (
                  <circle key={run[0].x} cx={run[0].x} cy={run[0].y as number} r={4} className="fill-accent" />
                ) : (
                  <polyline key={run[0].x} points={run.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" strokeWidth={CHART_STROKE + 0.5} strokeLinejoin="round" strokeDasharray={s.dash} className="stroke-accent" />
                ),
              )}
              {s.dots === true &&
                drawn.map((p, index) =>
                  p.y === null ? null : index === s.partialIndex ? (
                    <circle key={p.x} cx={p.x} cy={p.y} r={5} strokeWidth={2} className="fill-paper stroke-accent" />
                  ) : (
                    <circle key={p.x} cx={p.x} cy={p.y} r={4} className="fill-accent" />
                  ),
                )}
              {s.valueLabels === true &&
                drawn.map((p) =>
                  p.y === null || p.value === null ? null : (
                    <text key={`v${p.x}`} x={p.x} y={TOP - 10} fontSize={CHART_TEXT} textAnchor="middle" className="fill-ink">
                      {p.value}%
                    </text>
                  ),
                )}
              {last !== undefined && s.valueLabels !== true && <SeriesEnd series={s} last={last} right={LEFT + plotWidth} base={base} />}
            </g>
          );
        })}
      </ChartSvg>
    </ChartFigure>
  );
}
