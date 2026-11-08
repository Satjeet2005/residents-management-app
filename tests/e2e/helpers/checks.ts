import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { widthOf } from "./profiles";
import { shoot } from "./screenshot";

/**
 * The automated checks of every screen (T15, Part 2). `checkScreen` takes the screenshot, then asserts, for the page as it stands:
 * no horizontal overflow; every interactive element at least 48 x 48 px (a native checkbox or radio is measured by its label, which is the target) and at least
 * 8 px from its neighbours (there is NO 44 px exception: the design system allows none); the first Tab lands on an element with a visible focus ring; no console
 * error, page error, failed request or HTTP error since the last check; a page title and html lang; axe-core with no serious or critical violation (the moderate
 * and minor ones are listed in the JSON report); exactly one h1; at most one filled primary control (a button or link whose background is the accent token);
 * and no text below 14 px. Every failure names its selector. The report goes to test-results/checks/<area>-<screen>-<width>.json.
 */
export type Failure = { check: string; selector: string; detail: string };
export type Watch = { problems: string[] };

/** Starts listening for console errors, page errors and failed or erroring requests. Call it before the first navigation of a spec. */
export function watchPage(page: Page): Watch {
  const watch: Watch = { problems: [] };
  const origin = () => new URL(page.url() === "about:blank" ? (process.env.E2E_BASE_URL ?? "http://localhost:3000") : page.url()).origin;
  page.on("console", (message) => {
    if (message.type() === "error") watch.problems.push(`console error: ${message.text().slice(0, 200)}`);
  });
  page.on("pageerror", (error) => watch.problems.push(`page error: ${error.message.slice(0, 200)}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "failed";
    if (!failure.includes("ERR_ABORTED")) watch.problems.push(`request failed: ${request.method()} ${new URL(request.url()).pathname} ${failure}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && url.origin === origin()) watch.problems.push(`HTTP ${response.status()}: ${response.request().method()} ${url.pathname}`);
  });
  return watch;
}

type Measured = { selector: string; x: number; y: number; w: number; h: number; sticky: boolean };

/** Everything the browser can tell about the page's layout in one evaluation, so that the checks themselves are plain code. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = el.id === "" ? "" : `#${el.id}`;
      const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join("") : "";
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28);
      return `${tag}${id}${cls}${text === "" ? "" : ` "${text}"`}`;
    };
    // An open modal <dialog> (showModal) makes the rest of the page inert in the browser itself, without an `inert` attribute: what is outside it is not on screen for a person.
    const modal = [...document.querySelectorAll("dialog")].find((d) => d.open && d.matches(":modal"));
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && el.closest("[inert]") === null && el.closest("[hidden]") === null && el.closest('[aria-hidden="true"]') === null;
    };
    // The content of a closed <details> is not on screen (only its <summary> is), whatever box the browser still reports for it.
    const inClosedDetails = (el: Element): boolean => {
      for (let details = el.closest("details"); details !== null; details = details.parentElement?.closest("details") ?? null) {
        if (!details.open && el.closest("summary")?.parentElement !== details) return true;
      }
      return false;
    };
    const visible = (el: Element): boolean => shown(el) && !inClosedDetails(el) && (modal === undefined || modal.contains(el));
    const interactive = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"], [role="button"], [tabindex]:not([tabindex="-1"])')];
    const targets: Measured[] = [];
    for (const el of interactive) {
      // A native checkbox or radio is small by nature and its label is the target; a label that WRAPS the input is that target. A file input is its own target.
      const isCheck = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
      const box = isCheck ? (el.closest("label") ?? el) : el;
      if (!visible(box) && !(isCheck && visible(el))) continue;
      if (!isCheck && (el.getBoundingClientRect().width < 2 || el.getBoundingClientRect().height < 2)) continue;
      const r = box.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      let fixed = false;
      for (let up: Element | null = box; up !== null; up = up.parentElement) {
        const position = getComputedStyle(up).position;
        if (position === "fixed" || position === "sticky") fixed = true;
      }
      targets.push({ selector: describe(el), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, sticky: fixed });
    }
    const probe = document.createElement("div");
    probe.style.color = "var(--color-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const filled = interactive.filter((el) => (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button") && visible(el) && getComputedStyle(el).backgroundColor === accent).map(describe);
    const small: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || (node.textContent ?? "").trim() === "" || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
      const r = parent.getBoundingClientRect();
      if (!visible(parent) || r.width < 2 || r.height < 2) continue;
      if (parseFloat(getComputedStyle(parent).fontSize) < 14) small.push(`${describe(parent)} (${getComputedStyle(parent).fontSize})`);
    }
    return {
      overflow: { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth },
      targets,
      filled,
      small: [...new Set(small)],
      // The h1 behind a full-screen sheet is inert but still the page's one h1.
      h1: [...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().width > 0 && getComputedStyle(h).display !== "none").length,
      title: document.title.trim(),
      lang: document.documentElement.lang,
    };
  });
}

/** The first Tab: the element it lands on and whether it has a visible ring (a non-zero outline, or a box shadow). */
async function firstTab(page: Page): Promise<{ selector: string; ring: boolean } | null> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body || el === document.documentElement) return null;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== "none" && s.boxShadow !== "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28);
    return { selector: `${el.tagName.toLowerCase()}${el.id === "" ? "" : `#${el.id}`}${text === "" ? "" : ` "${text}"`}`, ring: outline || shadow };
  });
}

/** Spacing between targets. At the top of the page a sticky or fixed element (the bottom navigation, a sheet's footer) overlays the end of the content, which is a matter of scrolling and not of spacing, so only pairs of the same kind are measured there; at the END of the scroll the sticky element is in its place, and the pairs of one sticky and one ordinary element are measured. */
export function spacingFailures(targets: Measured[], phase: "top" | "end"): Failure[] {
  const out: Failure[] = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      if ((phase === "top") === (a.sticky !== b.sticky)) continue;
      const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
      const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
      const contains = (p: Measured, q: Measured) => p.x <= q.x + 0.5 && p.y <= q.y + 0.5 && p.x + p.w >= q.x + q.w - 0.5 && p.y + p.h >= q.y + q.h - 0.5;
      if (contains(a, b) || contains(b, a)) continue;
      const gap = Math.hypot(dx, dy);
      if (gap < 7.99) out.push({ check: "target spacing", selector: `${a.selector}  <->  ${b.selector}`, detail: `${Math.round(gap * 10) / 10} px apart${phase === "end" ? " (at the end of the scroll)" : ""}` });
    }
  }
  return out;
}

export function failuresOf(m: Awaited<ReturnType<typeof measure>>, width: number): Failure[] {
  const out: Failure[] = [];
  // Against the profile's width, not the page's own: a phone widens its layout viewport to fit wide content, which would make the page agree with itself.
  const widest = Math.max(m.overflow.scrollWidth, m.overflow.innerWidth);
  if (widest > width) out.push({ check: "overflow", selector: "html", detail: `the page is ${widest}px wide in a ${width}px viewport (scrollWidth ${m.overflow.scrollWidth}, innerWidth ${m.overflow.innerWidth})` });
  for (const t of m.targets) {
    if (t.w < 47.99 || t.h < 47.99) out.push({ check: "target size", selector: t.selector, detail: `${Math.round(t.w * 10) / 10} x ${Math.round(t.h * 10) / 10} px at ${Math.round(t.x)},${Math.round(t.y)}` });
  }
  out.push(...spacingFailures(m.targets, "top"));
  if (m.h1 !== 1) out.push({ check: "h1", selector: "h1", detail: `${m.h1} visible h1 elements` });
  if (m.filled.length > 1) out.push({ check: "one filled control", selector: m.filled.join("  |  "), detail: `${m.filled.length} filled controls` });
  for (const s of m.small) out.push({ check: "text size", selector: s, detail: "below 14px" });
  if (m.title === "") out.push({ check: "title", selector: "title", detail: "empty page title" });
  if (m.lang !== "en") out.push({ check: "lang", selector: "html", detail: `lang is "${m.lang}"` });
  void width;
  return out;
}

export async function checkScreen(page: Page, watch: Watch, area: string, screen: string): Promise<{ failures: Failure[]; notes: string[]; screenshot: string }> {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  const screenshot = await shoot(page, area, screen);
  const width = widthOf(page.viewportSize());
  const measured = await measure(page);
  const failures = failuresOf(measured, width);
  // The end of the scroll: the window and, in an open sheet, its scrolling body. The sticky bottom navigation and a sheet's sticky footer are then in their place.
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const el of document.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    }
  });
  failures.push(...spacingFailures((await measure(page)).targets, "end"));
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll("*")) if (el.scrollTop > 0) el.scrollTop = 0;
  });
  const tab = await firstTab(page);
  if (tab === null) failures.push({ check: "focus ring", selector: "body", detail: "the first Tab did not land on an element" });
  else if (!tab.ring) failures.push({ check: "focus ring", selector: tab.selector, detail: "no visible outline or box shadow on the first Tab" });
  for (const problem of watch.problems.splice(0)) failures.push({ check: "console or network", selector: "page", detail: problem });
  const axe = await new AxeBuilder({ page }).analyze();
  const notes: string[] = [];
  for (const v of axe.violations) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ");
    if (v.impact === "serious" || v.impact === "critical") failures.push({ check: `axe ${v.impact}`, selector: where, detail: `${v.id}: ${v.help}` });
    else notes.push(`axe ${v.impact ?? "unknown"}: ${v.id} (${v.nodes.length}): ${where}`);
  }
  mkdirSync(path.join("test-results", "checks"), { recursive: true });
  writeFileSync(path.join("test-results", "checks", `${area}-${screen}-${width}.json`), JSON.stringify({ area, screen, width, screenshot, failures, notes }, null, 2));
  const label = `${area}/${screen} at ${width}px (${screenshot})`;
  expect.soft(failures, `${label}\n${failures.map((f) => `  - [${f.check}] ${f.selector}: ${f.detail}`).join("\n")}`).toEqual([]);
  return { failures, notes, screenshot };
}
