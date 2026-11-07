import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { widthOf } from "./profiles";

const DIR = path.join("docs", "screenshots");
/** A screenshot in the repository must stay under 400 KB (the task's limit). */
export const MAX_BYTES = 400 * 1024;
const MAX_HEIGHT = 3200;

/**
 * Writes `docs/screenshots/<area>-<screen>-<width>.png` for the page's current look (the width is the viewport width). Images are taken at CSS pixel size, so a
 * phone with a device scale factor of 2 does not make a file four times as large. A long page is cut at 3,200 pixels, and a file still over 400 KB is cut
 * shorter until it fits; the path is returned for the report.
 */
export async function shoot(page: Page, area: string, screen: string): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${area}-${screen}-${widthOf(page.viewportSize())}.png`);
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const width = page.viewportSize()?.width ?? 0;
  let clipHeight = Math.min(height, MAX_HEIGHT);
  for (;;) {
    const image = await page.screenshot({ clip: { x: 0, y: 0, width, height: clipHeight }, fullPage: true, scale: "css", animations: "disabled", type: "png" });
    if (image.byteLength <= MAX_BYTES || clipHeight <= 800) {
      writeFileSync(file, image);
      break;
    }
    clipHeight = Math.max(800, Math.floor(clipHeight * 0.75));
  }
  if (statSync(file).size > MAX_BYTES) throw new Error(`${file} is over 400 KB`);
  return file;
}
