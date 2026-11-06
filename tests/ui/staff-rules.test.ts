import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** T12c: rules that hold for every staff screen, checked on the source so a later change cannot quietly break them. */
const STAFF = path.resolve(process.cwd(), "src/app/(staff)");
const RECON_LIB = path.resolve(process.cwd(), "src/lib/reconciliation");

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full, pattern) : pattern.test(entry.name) ? [full] : [];
  });
}
const rel = (file: string): string => path.relative(process.cwd(), file);
const tsx = files(STAFF, /\.tsx$/);
const all = [...files(STAFF, /\.tsx?$/), ...files(RECON_LIB, /\.ts$/)];

/** Visible text written straight into JSX: anything but whitespace and {expressions}. */
function literalTexts(source: string): string[] {
  const file = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && node.text.trim() !== "") found.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("SR1 every visible string comes from the message catalog", () => {
  it("there are staff pages to check", () => {
    expect(tsx.length).toBeGreaterThanOrEqual(20);
  });

  it("no staff component writes a sentence into its JSX", () => {
    const offenders = tsx.flatMap((file) => literalTexts(readFileSync(file, "utf8")).map((text) => `${rel(file)}: "${text}"`));
    expect(offenders).toEqual([]);
  });

  it("the checker finds literal text and ignores expressions", () => {
    expect(literalTexts("export const X = () => <p>Hello {name}</p>;")).toEqual(["Hello"]);
    expect(literalTexts("export const X = () => <p>{t('a')}</p>;")).toEqual([]);
  });
});

describe("SR2 there is no accept-all and no bulk action anywhere", () => {
  it("the staff source, the reconciliation logic and the message catalog never offer one", () => {
    const pattern = /accept all|approve all|post all|select all|reject all|\bbulk\b|accept every/i;
    const catalog = path.resolve(process.cwd(), "src/lib/messages/en.ts");
    const offenders = [...all, catalog].filter((file) => pattern.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("SR3 the approval threshold is never written into the screens (D116)", () => {
  it("no staff or reconciliation file contains a rupee threshold or its paise; the notice names the amount from the setting", () => {
    const offenders = all.filter((file) => /25,?000|10,?000|2_?500_?000|1_?000_?000\b/.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("SR4 every server action goes through withPermissionAction", () => {
  it("each 'use server' file under src/app builds its actions with it", () => {
    const actionFiles = files(path.resolve(process.cwd(), "src/app"), /\.tsx?$/).filter((file) => /^\s*["']use server["']/.test(readFileSync(file, "utf8")));
    expect(actionFiles.length).toBeGreaterThanOrEqual(2);
    const offenders = actionFiles.filter((file) => !/withPermissionAction\(/.test(readFileSync(file, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the load-more action asks for payments:match", () => {
    const source = readFileSync(path.join(STAFF, "staff/reconciliation/[importId]/actions.ts"), "utf8");
    expect(source).toMatch(/withPermissionAction\("payments:match"/);
  });
});
