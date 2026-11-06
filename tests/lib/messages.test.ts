import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/messages/en";
import { createT } from "@/lib/messages";

const SRC = path.resolve(process.cwd(), "src");
const CATALOG_DIR = path.join(SRC, "lib", "messages");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return full === CATALOG_DIR ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** What the code does with message keys: the keys it passes to t("..."), t calls whose key is not a literal, and every string literal (for keys held in config such as the navigation). */
export function scanKeys(source: string): { called: string[]; dynamic: number; literals: Set<string> } {
  const file = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const called: string[] = [];
  const literals = new Set<string>();
  let dynamic = 0;
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) literals.add(node.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteralLike(first)) called.push(first.text);
      else dynamic++;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { called, dynamic, literals };
}

describe("HM4 message catalog completeness", () => {
  const keys = Object.keys(en);
  const scans = sourceFiles(SRC).map((file) => ({ file: path.relative(process.cwd(), file), ...scanKeys(readFileSync(file, "utf8")) }));

  it("every key passed to t(...) exists in the catalog", () => {
    const missing = scans.flatMap((s) => s.called.filter((k) => !keys.includes(k)).map((k) => `${s.file}: ${k}`));
    expect(missing).toEqual([]);
  });

  it("every t(...) call uses a literal key (a built key cannot be checked)", () => {
    expect(scans.filter((s) => s.dynamic > 0).map((s) => `${s.file}: ${s.dynamic}`)).toEqual([]);
  });

  it("every catalog key is used somewhere in the code (as a t(...) key or a literal in a config)", () => {
    const used = new Set(scans.flatMap((s) => [...s.called, ...s.literals]));
    expect(keys.filter((k) => !used.has(k))).toEqual([]);
  });

  it("every message is a non-empty sentence without a trailing space, and every {parameter} is well formed", () => {
    for (const [key, message] of Object.entries(en as Record<string, string>)) {
      expect(message.trim(), key).not.toBe("");
      expect(message, key).toBe(message.trim());
      for (const match of message.matchAll(/\{([^}]*)\}/g)) expect(match[1], key).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it("no message uses upper case for effect: all-capital words are not used (the design bans uppercase)", () => {
    for (const [key, message] of Object.entries(en as Record<string, string>)) {
      // IFSC is the bank's own name for a branch code, not capitals used for effect: it is the one allowed acronym.
      expect(/\b[A-Z]{4,}\b/.test(message.replace(/\{[^}]*\}/g, "").replace(/\bIFSC\b/g, "")), `${key}: ${message}`).toBe(false);
    }
  });
});

describe("HM4 the scanner and t() themselves", () => {
  it("finds t keys, dynamic calls and literals", () => {
    const scan = scanKeys(`const a = t("one.key"); const b = t(\`two.\${x}\`); const c = { labelKey: "three.key" }; t(name);`);
    expect(scan.called).toEqual(["one.key"]);
    expect(scan.dynamic).toBe(2);
    expect(scan.literals.has("three.key")).toBe(true);
  });

  const t = createT({ plain: "Hello", named: "Hello {name}, you have {count} things", twice: "{n} and {n}" });
  it("returns a message, fills parameters (numbers too), and fills a repeated one twice", () => {
    expect(t("plain")).toBe("Hello");
    expect(t("named", { name: "Swati", count: 2 })).toBe("Hello Swati, you have 2 things");
    expect(t("twice", { n: 7 })).toBe("7 and 7");
  });

  it("throws for a missing parameter and never shows a raw {name}", () => {
    expect(() => t("named", { name: "Swati" })).toThrow(/count/);
    expect(() => t("named")).toThrow(RangeError);
  });

  it("throws for an unknown key", () => {
    expect(() => (t as unknown as (k: string) => string)("nope")).toThrow(/nope/);
  });
});
