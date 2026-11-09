/**
 * The rules of the text-overlap check (Phase 03, a standing item of `docs/ui-fix-protocol.md`), as plain code on plain numbers so that a unit test can feed them the
 * box layout of an old design. It fails when two texts intersect, when a text is crossed by a drawn line (a goal line over its own label, a data line over a value),
 * when a text falls outside its container, or when a clipping ancestor cuts a text. The failure names the two texts. `overlap.ts` takes the boxes from a real browser.
 */
export type Box = { x: number; y: number; w: number; h: number };
/** `node` identifies the DOM text node: the lines of one wrapped paragraph share it and are never compared with each other. `clipped` is set by the browser. */
export type TextItem = Box & { text: string; node: number; clipped: boolean };
/** A drawn line (an svg line, polyline or path), as points along it in page pixels. */
export type Stroke = { label: string; points: { x: number; y: number }[] };
export type OverlapFailure = { check: "text overlap" | "text on a line" | "text outside" | "text clipped"; detail: string };

/** Sub-pixel noise below these sizes is not an overlap. */
const MIN_OVERLAP_W = 1;
const MIN_OVERLAP_H = 2;

const quoted = (text: string): string => `"${text.trim().replace(/\s+/g, " ").slice(0, 40)}"`;
const intersection = (a: Box, b: Box): { w: number; h: number } => ({
  w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
  h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
});

export function overlapFailures(texts: readonly TextItem[], strokes: readonly Stroke[], container: Box): OverlapFailure[] {
  const out: OverlapFailure[] = [];
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i];
    if (a.clipped) out.push({ check: "text clipped", detail: `${quoted(a.text)} is cut by a clipping ancestor` });
    if (a.x < container.x - 1 || a.y < container.y - 1 || a.x + a.w > container.x + container.w + 1 || a.y + a.h > container.y + container.h + 1) {
      out.push({ check: "text outside", detail: `${quoted(a.text)} is outside its container` });
    }
    for (let j = i + 1; j < texts.length; j++) {
      const b = texts[j];
      if (a.node === b.node) continue;
      const overlap = intersection(a, b);
      if (overlap.w > MIN_OVERLAP_W && overlap.h > MIN_OVERLAP_H) out.push({ check: "text overlap", detail: `${quoted(a.text)} and ${quoted(b.text)} overlap by ${Math.round(overlap.w)} x ${Math.round(overlap.h)} px` });
    }
    // A point of a line inside the text box, shrunk by 1px so that a line that only touches the edge of the box is not a crossing.
    const inner = { x: a.x + 1, y: a.y + 1, w: a.w - 2, h: a.h - 2 };
    for (const stroke of strokes) {
      if (stroke.points.some((p) => p.x > inner.x && p.x < inner.x + inner.w && p.y > inner.y && p.y < inner.y + inner.h)) out.push({ check: "text on a line", detail: `${quoted(a.text)} is crossed by ${stroke.label}` });
    }
  }
  return out;
}
