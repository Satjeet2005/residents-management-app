import { expect, type Locator } from "@playwright/test";
import { type Box, type Stroke, type TextItem, overlapFailures } from "./overlap-rules";

/** The boxes of the texts and lines inside `scope`, taken from the browser as it is (closed <details> content and zero-size texts are not on screen and are left out). */
export async function collectBoxes(scope: Locator): Promise<{ container: Box; texts: TextItem[]; strokes: Stroke[] }> {
  return scope.evaluate((root) => {
    const page = (r: DOMRect): Box => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
    const onScreen = (el: Element | null): boolean => {
      for (let up = el; up !== null; up = up.parentElement) {
        const s = getComputedStyle(up);
        if (s.display === "none" || s.visibility === "hidden") return false;
        if (up instanceof HTMLDetailsElement && !up.open) {
          const summary = el?.closest("summary");
          if (summary === null || summary === undefined || summary.parentElement !== up) return false;
        }
      }
      return true;
    };
    const clippedBy = (el: Element, r: DOMRect): boolean => {
      for (let up = el.parentElement; up !== null && up !== document.body; up = up.parentElement) {
        const s = getComputedStyle(up);
        if (s.overflowX === "visible" && s.overflowY === "visible") continue;
        const box = up.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) return true;
      }
      return false;
    };
    const describe = (el: Element): string => {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
      return `${el.tagName.toLowerCase()}${text === "" ? "" : ` "${text}"`}`;
    };
    const texts: { x: number; y: number; w: number; h: number; text: string; node: number; clipped: boolean }[] = [];
    let node = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
      const parent = current.parentElement;
      const value = (current.textContent ?? "").trim();
      if (parent === null || value === "" || ["SCRIPT", "STYLE", "NOSCRIPT", "TITLE", "DESC"].includes(parent.tagName.toUpperCase()) || !onScreen(parent)) continue;
      // Text in a box of 1px (sr-only, for a screen reader) is not on screen for a person, although its text still has a rectangle.
      const own = parent.getBoundingClientRect();
      if (own.width < 2 || own.height < 2) continue;
      node += 1;
      const range = document.createRange();
      range.selectNodeContents(current);
      for (const rect of range.getClientRects()) {
        if (rect.width < 2 || rect.height < 2) continue;
        texts.push({ ...page(rect), text: value, node, clipped: clippedBy(parent, rect) });
      }
    }
    const strokes: { label: string; points: { x: number; y: number }[] }[] = [];
    for (const el of root.querySelectorAll("svg line, svg polyline, svg path")) {
      if (!onScreen(el) || !(el instanceof SVGGeometryElement)) continue;
      const matrix = el.getScreenCTM();
      if (matrix === null) continue;
      const length = el.getTotalLength();
      const points: { x: number; y: number }[] = [];
      for (let at = 0; at <= length; at += 3) {
        const p = el.getPointAtLength(at).matrixTransform(matrix);
        points.push({ x: p.x + scrollX, y: p.y + scrollY });
      }
      strokes.push({ label: `a ${describe(el)} line`, points });
    }
    return { container: page(root.getBoundingClientRect()), texts, strokes };
  });
}

/** Fails (soft, so every figure of a page is reported) when the element has overlapping, line-crossed, outside or clipped text. `label` names the element in the message. */
export async function assertNoTextOverlap(scope: Locator, label: string): Promise<void> {
  const { container, texts, strokes } = await collectBoxes(scope);
  expect(texts.length, `${label}: no text found to check`).toBeGreaterThan(0);
  const failures = overlapFailures(texts, strokes, container);
  expect.soft(failures, `${label}\n${failures.map((f) => `  - [${f.check}] ${f.detail}`).join("\n")}`).toEqual([]);
}
