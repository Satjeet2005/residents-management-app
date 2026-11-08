import { CHART_STROKE, CHART_TEXT } from "./chart-tokens";
import { type ChartText, ChartFigure, ChartSvg, runsOf } from "./chart-parts";

export const MAX_SERIES = 3;
const WIDTH = 560;
const HEIGHT = 300;
const LEFT = 52;
const RIGHT = 16;
const TOP = 24;
const BOTTOM = 56;

export type LineSeries = {
  label: string;
  /** x in the chart's own unit (a day, a week number); y 0 to 100 or null for a gap. */
  points: readonly { x: number; y: number | null }[];
  /** A dash pattern, so a second series differs by more than colour. Undefined is a solid line. */
  dash?: string;
  /** A dot on every point (for a series of few points). */
  dots?: boolean;
};

/**
 * C3 and C4 (from 768px): up to three lines from 0 to 100 percent with a labelled y axis, a few labelled x ticks, an optional goal line (dashed, written at its left end),
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
  const x = (value: number) => LEFT + (xMax === 0 ? plotWidth / 2 : (value * plotWidth) / xMax);
  const y = (value: number) => TOP + plotHeight - (Math.max(0, Math.min(100, value)) * plotHeight) / 100;
  const base = TOP + plotHeight;
  return (
    <ChartFigure text={text}>
      <ChartSvg text={text} width={WIDTH} height={HEIGHT}>
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
        <text x={LEFT + plotWidth / 2} y={HEIGHT - 8} fontSize={CHART_TEXT} textAnchor="middle" className="fill-ink-2">
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
            <text x={LEFT + 6} y={y(goal.percent) - 6} fontSize={CHART_TEXT} className="fill-ink-2">
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
              {s.dots === true && drawn.map((p) => p.y !== null && <circle key={p.x} cx={p.x} cy={p.y} r={4} className="fill-accent" />)}
              {last !== undefined && (
                <text x={last.x} y={(last.y as number) < TOP + 40 ? (last.y as number) + 24 : (last.y as number) - 10} fontSize={CHART_TEXT} fontWeight={600} textAnchor="end" className="fill-ink">
                  {s.label} {last.value}%
                </text>
              )}
            </g>
          );
        })}
      </ChartSvg>
    </ChartFigure>
  );
}
