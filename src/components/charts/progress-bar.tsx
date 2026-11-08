import { CHART_STROKE } from "./chart-tokens";
import { type ChartText, ChartFigure, ChartSvg } from "./chart-parts";

const WIDTH = 296;
const HEIGHT = 16;

/**
 * M1: one share as a bar (a track and its fill) with no goal marker. The value itself is printed by the card around it, so the bar is never the only way to read it.
 * `percent` is 0 to 100, or null for "No data" (the track alone).
 */
export function ProgressBar({ text, percent }: { text: ChartText; percent: number | null }) {
  const inner = WIDTH - 2 * CHART_STROKE;
  const fill = percent === null ? 0 : Math.max(0, Math.min(100, percent)) * inner / 100;
  return (
    <ChartFigure text={text}>
      <ChartSvg text={text} width={WIDTH} height={HEIGHT}>
        <rect x={CHART_STROKE / 2} y={CHART_STROKE / 2} width={WIDTH - CHART_STROKE} height={HEIGHT - CHART_STROKE} rx={4} strokeWidth={CHART_STROKE} className="fill-paper stroke-hairline" />
        {fill > 0 && <rect x={CHART_STROKE} y={CHART_STROKE} width={fill} height={HEIGHT - 2 * CHART_STROKE} rx={3} className="fill-accent" />}
      </ChartSvg>
    </ChartFigure>
  );
}
