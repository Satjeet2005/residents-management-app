/**
 * The ONE place that locks the page's scroll while a sheet is open (D184). Reference counted, so a second sheet opened before the first one
 * closed cannot leave the lock on or take it off early. The first lock fixes the body at the current scroll position (this also stops iOS
 * from scrolling the page behind a dialog) and keeps the scrollbar's gutter, so the page does not shift on a desktop; the last release puts
 * every style back and restores the exact scroll position. Only `Sheet` calls it; a test scans the sources for anything else that touches
 * the overflow of the document.
 */
type Saved = { scrollY: number; html: Pick<CSSStyleDeclaration, "overflow" | "scrollbarGutter">; body: Pick<CSSStyleDeclaration, "position" | "top" | "left" | "right" | "width" | "overflow"> };

let locks = 0;
let saved: Saved | null = null;

/** The number of locks held now. For tests. */
export const lockCount = (): number => locks;

/** Locks the page scroll and returns a release function that is safe to call more than once. On the server it does nothing. */
export function lockScroll(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => undefined;
  if (locks === 0) {
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const hadScrollbar = window.innerWidth - html.clientWidth > 0;
    saved = {
      scrollY,
      html: { overflow: html.style.overflow, scrollbarGutter: html.style.scrollbarGutter },
      body: { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow },
    };
    html.style.overflow = "hidden";
    if (hadScrollbar) html.style.scrollbarGutter = "stable";
    body.style.position = "fixed";
    body.style.top = `${-scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks > 0 || saved === null) return;
    const html = document.documentElement;
    const body = document.body;
    const before = saved;
    saved = null;
    html.style.overflow = before.html.overflow;
    html.style.scrollbarGutter = before.html.scrollbarGutter;
    Object.assign(body.style, before.body);
    window.scrollTo({ top: before.scrollY, left: 0, behavior: "instant" });
  };
}
