import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { PAPER } from "@/lib/brand";
import { colourTokens, contrast } from "./css-tokens";

const m = manifest();
const tokens = colourTokens();
const fileOf = (src: string): string => path.resolve(process.cwd(), "public", src.replace(/^\//, ""));

/** The width and height of a PNG, from its header. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("T15 the web app manifest", () => {
  it("has the fields an installable app needs", () => {
    expect(m).toMatchObject({ name: "Township", short_name: "Township", start_url: "/", scope: "/", display: "standalone", orientation: "portrait", lang: "en" });
    expect(m.description).toBeTruthy();
  });

  it("lists a 192, a 512 and a maskable 512 icon, and each file exists at exactly that size", () => {
    const icons = m.icons ?? [];
    const has = (size: string, purpose: string) => icons.some((i) => i.sizes === size && i.purpose === purpose && i.type === "image/png");
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
    for (const icon of icons) {
      const file = fileOf(icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const [w, h] = (icon.sizes as string).split("x").map(Number);
      expect(pngSize(file), icon.src).toEqual({ width: w, height: h });
    }
  });

  it("the theme and background colours are the paper token, and dark status-bar icons on it read at 4.5:1 or more", () => {
    expect(PAPER).toBe(tokens.paper);
    expect(m.theme_color).toBe(tokens.paper);
    expect(m.background_color).toBe(tokens.paper);
    expect(contrast(tokens.ink, m.theme_color as string)).toBeGreaterThanOrEqual(4.5);
  });

  it("the icon mark uses only the ink and paper tokens, and has no text", () => {
    const svg = readFileSync(path.resolve(process.cwd(), "public/icons/mark.svg"), "utf8");
    const colours = new Set([...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((x) => x[1].toLowerCase()));
    expect([...colours].sort()).toEqual([tokens.ink, tokens.paper].sort());
    expect(svg).not.toMatch(/<text|<image/);
  });
});
