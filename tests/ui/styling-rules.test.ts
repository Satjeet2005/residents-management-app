import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Sheet } from "@/components/ui/sheet";
import { SCANNED_FILES } from "./class-scan";
import { GLOBALS_CSS } from "./css-tokens";

const UI_DIR = path.resolve(process.cwd(), "src/components/ui");
const sourceFiles = readdirSync(UI_DIR).filter((f) => /\.(tsx?|css)$/.test(f));
const read = (file: string) => readFileSync(path.join(UI_DIR, file), "utf8");

/** Source without comments, so a comment that explains a rule does not trip the rule. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const cssCode = code(GLOBALS_CSS);
const allCode: [string, string][] = [...sourceFiles.map((f): [string, string] => [f, code(read(f))]), ["globals.css", cssCode]];

describe("T3 no forbidden styling", () => {
  it("T3 there are component files to check", () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(12);
  });

  it("T3 no uppercase or letter-spacing in any component (globals.css may only reset letter-spacing to 0)", () => {
    for (const [file, text] of allCode) {
      expect(text, file).not.toMatch(/\buppercase\b|\blowercase\b|\bcapitalize\b|text-transform:\s*(?!none)[a-z]/);
      if (file === "globals.css") {
        for (const m of text.matchAll(/letter-spacing:\s*([^;]+);/g)) expect(m[1].trim(), "letter-spacing in globals.css").toBe("0");
      } else {
        expect(text, file).not.toMatch(/letter-spacing|\btracking-/);
      }
    }
  });

  it("T3 no shadows, no gradients", () => {
    for (const [file, rawText] of allCode) {
      const text = rawText.replace(/^.*:\s*initial;.*$/gm, ""); // the theme lines that switch shadows off
      expect(text, file).not.toMatch(/box-shadow|text-shadow|\bshadow(-|\b)|drop-shadow|gradient/);
    }
  });

  it("T3 no italic in any file that renders text", () => {
    for (const [file, text] of allCode) expect(text, file).not.toMatch(/\bitalic\b|font-style:\s*italic/);
    for (const file of SCANNED_FILES) expect(code(readFileSync(file, "utf8")), file).not.toMatch(/\bitalic\b/);
  });

  it("T3 only weights 400 and 600, and no hex colours inside components (colours come from tokens)", () => {
    for (const [file, text] of allCode) {
      if (file === "globals.css") continue;
      expect(text, file).not.toMatch(/\bfont-(thin|extralight|light|medium|bold|extrabold|black)\b/);
      expect(text, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("T3 the theme switches off every default it does not use (colours, sizes, radii, shadows, tracking)", () => {
    for (const reset of ["--color-*: initial", "--text-*: initial", "--radius-*: initial", "--shadow-*: initial", "--tracking-*: initial"]) {
      expect(cssCode).toContain(reset);
    }
  });

  it("T3 no fixed h- height on an interactive component: only min-h", () => {
    for (const file of ["button.tsx", "section-header.tsx", "block-error.tsx", "sheet.tsx"]) {
      expect(code(read(file)), file).not.toMatch(/(^|[\s"'`:])h-(\d|\[|full|screen|px)/);
    }
  });
});

const minHeightPx = (markup: string): number => {
  const rem = [...markup.matchAll(/\bmin-h-(\d+)\b/g)].map((m) => Number(m[1]) * 4);
  return Math.max(0, ...rem);
};
const tagOf = (markup: string, tag: string): string => {
  const match = new RegExp(`<${tag}\\b[^>]*>`).exec(markup);
  if (match === null) throw new Error(`no <${tag}> in the markup`);
  return match[0];
};

describe("T4 layout rules", () => {
  it("T4 the spacing token is 4px, so min-h-12 is 48px and min-h-14 is 56px", () => {
    expect(cssCode).toMatch(/--spacing:\s*4px/);
  });

  it("T4 a default Button is at least 48px tall, in every variant", () => {
    for (const variant of ["primary", "outlined", "link"] as const) {
      expect(minHeightPx(tagOf(renderToStaticMarkup(h(Button, { variant }, "x")), "button")), variant).toBeGreaterThanOrEqual(48);
    }
  });

  it("T4 a large Button is at least 56px tall, and so is the disabled one", () => {
    expect(minHeightPx(tagOf(renderToStaticMarkup(h(Button, { size: "large" }, "Pay")), "button"))).toBeGreaterThanOrEqual(56);
    expect(minHeightPx(tagOf(renderToStaticMarkup(h(Button, { size: "large", disabled: true }, "Pay")), "button"))).toBeGreaterThanOrEqual(56);
    expect(minHeightPx(tagOf(renderToStaticMarkup(h(Button, { size: "large", loading: true }, "Pay")), "button"))).toBeGreaterThanOrEqual(56);
  });

  it("T4 the SectionHeader link, the Sheet Close button and the BlockError button are at least 48px tall", () => {
    const link = tagOf(renderToStaticMarkup(h(SectionHeader, { title: "T", action: { label: "See all", href: "/x" } })), "a");
    expect(minHeightPx(link)).toBeGreaterThanOrEqual(48);
    const sheet = renderToStaticMarkup(h(Sheet, { open: false, onClose: () => undefined, title: "T", children: "B" }));
    expect(minHeightPx(tagOf(sheet, "button"))).toBeGreaterThanOrEqual(48);
    const error = renderToStaticMarkup(h(BlockError, { message: "m", onRetry: () => undefined }));
    expect(minHeightPx(tagOf(error, "button"))).toBeGreaterThanOrEqual(48);
  });

  it("T4 the controls have at least 8px between them (gap-2 or more) where they sit together", () => {
    expect(readFileSync(path.join(UI_DIR, "sheet.tsx"), "utf8")).toMatch(/justify-between gap-4/);
    expect(readFileSync(path.join(UI_DIR, "section-header.tsx"), "utf8")).toMatch(/justify-between gap-4/);
  });

  it("T4 radii are 8 for controls and 12 for sheets", () => {
    expect(cssCode).toMatch(/--radius-control:\s*8px/);
    expect(cssCode).toMatch(/--radius-sheet:\s*12px/);
  });

  it("T4 the type scale is 14/16/20/24/40 at 1.5 (hero 1.2), and Devanagari is 1.6 with no letter-spacing", () => {
    for (const [name, size] of [["caption", 14], ["body", 16], ["title", 20], ["heading", 24], ["hero", 40]] as const) {
      expect(cssCode).toContain(`--text-${name}: ${size}px`);
    }
    expect(cssCode).toMatch(/--text-hero--line-height:\s*1\.2/);
    expect(cssCode).toMatch(/:lang\(hi\)[\s\S]*:lang\(mr\)[\s\S]*line-height:\s*1\.6;[\s\S]*letter-spacing:\s*0;[\s\S]*text-transform:\s*none/);
  });
});
