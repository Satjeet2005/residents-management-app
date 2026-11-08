import { CHART_STROKE, CHART_TEXT } from "./chart-tokens";
import { type ChartText, ChartFigure, ChartSvg, runsOf } from "./chart-parts";

const WIDTH = 224;
const HEIGHT = 92;
const LEFT = 6;
const RIGHT = 52;
const TOP = 12;
const BOTTOM = 28;

export type SparkPoint = { label: string; value: number | null };

/**
 * M2: a trend of up to eight values from 0 to 100 as a line, with the LAST value written at its end, the first and last labels under it, and the goal as a dashed
 * tick line written "Goal 90%". A value of null is a gap: the line breaks and no point is drawn. Nothing in it can be tapped or hovered.
 */
export function Sparkline({ text, points, goal }: { text: ChartText; points: readonly SparkPoint[]; goal: { percent: number; label: string } | null }) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const x = (index: number) => LEFT + (points.length === 1 ? plotWidth / 2 : (index * plotWidth) / (points.length - 1));
  const y = (value: number) => TOP + plotHeight - (Math.max(0, Math.min(100, value)) * plotHeight) / 100;
  const drawn = points.map((p, index) => ({ x: x(index), y: p.value === null ? null : y(p.value) }));
  const lastIndex = points.findLastIndex((p) => p.value !== null);
  const goalY = goal === null ? 0 : y(goal.percent);
  return (
    <ChartFigure text={text}>
      <ChartSvg text={text} width={WIDTH} height={HEIGHT}>
        {goal !== null && (
          <>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={goalY} y2={goalY} strokeWidth={CHART_STROKE} strokeDasharray="6 4" className="stroke-ink-2" />
            <text x={LEFT} y={goalY < TOP + CHART_TEXT ? goalY + CHART_TEXT + 2 : goalY - 4} fontSize={CHART_TEXT} className="fill-ink-2">
              {goal.label}
            </text>
          </>
        )}
        {runsOf(drawn).map((run) =>
          run.length === 1 ? (
            <circle key={run[0].x} cx={run[0].x} cy={run[0].y as number} r={3} className="fill-accent" />
          ) : (
            <polyline key={run[0].x} points={run.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" strokeWidth={CHART_STROKE + 0.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-accent" />
          ),
        )}
        {lastIndex >= 0 && (
          <>
            <circle cx={drawn[lastIndex].x} cy={drawn[lastIndex].y as number} r={4} className="fill-accent" />
            <text x={drawn[lastIndex].x + 8} y={(drawn[lastIndex].y as number) + 5} fontSize={CHART_TEXT} fontWeight={600} className="fill-ink">
              {points[lastIndex].value}%
            </text>
          </>
        )}
        <text x={LEFT} y={HEIGHT - 6} fontSize={CHART_TEXT} className="fill-ink-2">
          {points[0].label}
        </text>
        {points.length > 1 && (
          <text x={WIDTH - RIGHT} y={HEIGHT - 6} fontSize={CHART_TEXT} textAnchor="end" className="fill-ink-2">
            {points[points.length - 1].label}
          </text>
        )}
      </ChartSvg>
    </ChartFigure>
  );
}
