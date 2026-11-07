import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Renders public/icons/mark.svg to the PNG icons the web app manifest and iOS need, with the Chromium that Playwright already installed (no new dependency).
 * Run it with `npm run icons`; the SVG and the PNGs are both committed, so a build never needs this. The mark has its content inside the central 60%, so the one
 * image serves as the "any" icon and as the maskable icon.
 */
const DIR = path.join("public", "icons");
const TARGETS: { file: string; size: number }[] = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

async function main(): Promise<void> {
  const svg = readFileSync(path.join(DIR, "mark.svg"), "utf8");
  const browser = await chromium.launch();
  try {
    for (const { file, size } of TARGETS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      writeFileSync(path.join(DIR, file), await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size, height: size } }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
