import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lockCount, lockScroll } from "@/lib/scroll-lock";

type Style = Record<string, string>;
const blank = (): Style => ({ overflow: "", scrollbarGutter: "", position: "", top: "", left: "", right: "", width: "" });

function fakeBrowser(scrollY: number, scrollbar: number) {
  const html = { style: blank(), clientWidth: 1280 - scrollbar };
  const body = { style: blank() };
  const scrollTo = vi.fn();
  vi.stubGlobal("document", { documentElement: html, body });
  vi.stubGlobal("window", { scrollY, innerWidth: 1280, scrollTo });
  return { html, body, scrollTo };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("SL1 the page scroll lock (D184)", () => {
  it("locks the page, keeps the scrollbar gutter, and restores every style and the exact scroll position", () => {
    const { html, body, scrollTo } = fakeBrowser(731, 15);
    html.style.overflow = "auto";
    const release = lockScroll();
    expect(html.style.overflow).toBe("hidden");
    expect(html.style.scrollbarGutter).toBe("stable");
    expect(body.style.position).toBe("fixed");
    expect(body.style.top).toBe("-731px");
    release();
    expect(html.style.overflow).toBe("auto");
    expect(html.style.scrollbarGutter).toBe("");
    expect(body.style).toEqual(blank());
    expect(scrollTo).toHaveBeenCalledWith({ top: 731, left: 0, behavior: "instant" });
    expect(lockCount()).toBe(0);
  });

  it("adds no gutter when the page had no scrollbar (nothing to compensate, so no shift)", () => {
    const { html } = fakeBrowser(0, 0);
    const release = lockScroll();
    expect(html.style.scrollbarGutter).toBe("");
    release();
  });

  it("is reference counted: the lock stays until the LAST sheet releases", () => {
    const { body, scrollTo } = fakeBrowser(40, 0);
    const first = lockScroll();
    const second = lockScroll();
    expect(lockCount()).toBe(2);
    first();
    expect(body.style.position).toBe("fixed");
    expect(scrollTo).not.toHaveBeenCalled();
    second();
    expect(body.style.position).toBe("");
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("a release is idempotent: calling it twice cannot take another sheet's lock away", () => {
    const { body } = fakeBrowser(0, 0);
    const first = lockScroll();
    const second = lockScroll();
    first();
    first();
    expect(lockCount()).toBe(1);
    expect(body.style.position).toBe("fixed");
    second();
    expect(lockCount()).toBe(0);
  });

  it("consecutive sheets lock and unlock cleanly three times", () => {
    const { html, body } = fakeBrowser(120, 15);
    for (let i = 0; i < 3; i++) {
      const release = lockScroll();
      release();
      expect(html.style.overflow).toBe("");
      expect(body.style).toEqual(blank());
    }
  });

  it("does nothing on the server (no document)", () => {
    vi.stubGlobal("document", undefined);
    const release = lockScroll();
    expect(lockCount()).toBe(0);
    expect(() => release()).not.toThrow();
  });
});

describe("SL2 only the shared Sheet touches the document's overflow", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

  it("no other source file sets overflow on document.body or document.documentElement", () => {
    const offenders = files(path.resolve(process.cwd(), "src"))
      .filter((file) => !file.endsWith(path.join("lib", "scroll-lock.ts")))
      .filter((file) => /document\.(body|documentElement)(\.style)?[^;\n]*overflow|(body|documentElement)\.style\.overflow/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the Sheet is the only caller of lockScroll", () => {
    const callers = files(path.resolve(process.cwd(), "src"))
      .filter((file) => !file.endsWith(path.join("lib", "scroll-lock.ts")))
      .filter((file) => readFileSync(file, "utf8").includes("lockScroll("))
      .map((file) => path.relative(process.cwd(), file));
    expect(callers).toEqual([path.join("src", "components", "ui", "sheet.tsx")]);
  });
});
