import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findViolations } from "../../domain-imports.test";
import { type ArmResult, decideClassification, defaultClassificationPolicy } from "@/domain/complaints/decision";
import { deidentify } from "@/domain/complaints/deidentify";
import { detectSafetyWords } from "@/domain/complaints/safety";
import { CATEGORY_CODES, MODEL_URGENCIES } from "@/domain/complaints/taxonomy";
import { createPrng } from "@/domain/seed/prng";

/** CP6: the complaint code is pure (no I/O, no clock, no randomness, no locale), fast, and its parts agree with each other. */
const DIR = path.resolve(process.cwd(), "src/domain/complaints");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
const read = (file: string): string => readFileSync(path.join(DIR, file), "utf8");

/** What a source file refers to: imported modules, and member or global names, without comments and strings. */
function references(source: string): { imports: string[]; names: Set<string>; members: Set<string> } {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const names = new Set<string>();
  const members = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isIdentifier(node)) names.add(node.text);
    if (ts.isPropertyAccessExpression(node)) members.add(`${node.expression.getText()}.${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { imports, names, members };
}

describe("CP6 purity", () => {
  it("there are the modules of the design", () => {
    expect(FILES.sort()).toEqual(expect.arrayContaining(["taxonomy.ts", "text.ts", "safety.ts", "deidentify.ts", "fallback.ts", "decision.ts"]));
  });

  it("the domain import allowlist passes for every file of the complaint code (relative imports inside src/domain only)", () => {
    for (const file of FILES) expect(findViolations(read(file), path.join(DIR, file)), file).toEqual([]);
  });

  it("no file imports a node: built-in or a package", () => {
    for (const file of FILES) expect(references(read(file)).imports.filter((i) => !i.startsWith(".")), file).toEqual([]);
  });

  it("no file uses Intl, Math.random, Date.now, new Date, process, fetch, console or setTimeout", () => {
    const forbiddenNames = ["Intl", "process", "fetch", "console", "setTimeout", "setInterval", "require"];
    const forbiddenMembers = ["Math.random", "Date.now", "crypto.randomUUID", "performance.now"];
    for (const file of FILES) {
      const { names, members } = references(read(file));
      expect(forbiddenNames.filter((n) => names.has(n)), file).toEqual([]);
      expect(forbiddenMembers.filter((m) => members.has(m)), file).toEqual([]);
      expect(/new\s+Date\s*\(/.test(read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), `${file}: new Date`).toBe(false);
    }
  });

  it("the checker finds what it should", () => {
    const found = references('import fs from "node:fs"; const a = Math.random(); const b = new Intl.NumberFormat();');
    expect(found.imports).toEqual(["node:fs"]);
    expect(found.members.has("Math.random")).toBe(true);
    expect(found.names.has("Intl")).toBe(true);
  });
});

describe("CP6 speed", () => {
  it("1,000 decisions take well under 0.5 s of work on 2 CPUs (the limit here allows a loaded machine)", () => {
    const texts = ["water leak in the bathroom", "लिफ्ट में फंस गए हैं", "garbage not collected for three days, urgent", "the lift light is out", "gas ka smell aa raha hai", "नल से पानी टपक रहा है", "something is wrong"];
    const arms: ArmResult[] = [
      { arm: "NATIVE", categories: CATEGORY_CODES.map((label, i) => ({ label, probability: i === 0 ? 0.6 : 0.1 })), urgencies: MODEL_URGENCIES.map((label, i) => ({ label, probability: i === 1 ? 0.8 : 0.1 })) },
      { arm: "TRANSLATED", categories: CATEGORY_CODES.map((label, i) => ({ label, probability: i === 0 ? 0.7 : 0.075 })), urgencies: MODEL_URGENCIES.map((label, i) => ({ label, probability: i === 1 ? 0.8 : 0.1 })) },
    ];
    decideClassification({ rawText: "warm up", arms, policy: defaultClassificationPolicy });
    const started = performance.now();
    for (let i = 0; i < 1000; i++) decideClassification({ rawText: texts[i % texts.length], arms, policy: defaultClassificationPolicy });
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("CP6 the parts agree", () => {
  it("de-identifying a complaint never hides a safety word (the model reads de-identified text, the rules read the original: both must see the same danger)", () => {
    const samples = [
      "Mr Sharma T12-0408 mein aag lagi hai, call 9876543210",
      "आम्ही लिफ्टमध्ये अडकलो आहोत, माझा नंबर ९८७६५४३२१०",
      "gas leak in T21-1601 please call aamir.s@oksbi",
      "Aamir Shaikh got an electric shock, see https://x.example/photo",
      "Dr Mehta lift mein phans gaye T03-0402",
      "बिजली का झटका लगा, फ्लैट T05-0507",
    ];
    for (const text of samples) {
      const before = detectSafetyWords(text).map((h) => h.category);
      const after = detectSafetyWords(deidentify(text, { knownNames: ["Aamir Shaikh"] }).text).map((h) => h.category);
      expect(before.length, text).toBeGreaterThan(0);
      expect(new Set(after), text).toEqual(new Set(before));
    }
  });

  it("with agreement required, the order of the arms does not change the decision (400 seeded cases)", () => {
    const rng = createPrng(20261110);
    const make = (name: "DIRECT" | "NATIVE" | "TRANSLATED"): ArmResult => {
      const category = rng.pick(CATEGORY_CODES);
      const p = rng.pick([0.6, 0.75, 0.9]);
      const others = CATEGORY_CODES.filter((c) => c !== category);
      const urgency = rng.pick(MODEL_URGENCIES);
      const others2 = MODEL_URGENCIES.filter((u) => u !== urgency);
      const q = rng.pick([0.5, 0.8]);
      return {
        arm: name,
        categories: [{ label: category, probability: p }, ...others.map((label) => ({ label, probability: (1 - p) / others.length }))],
        urgencies: [{ label: urgency, probability: q }, ...others2.map((label) => ({ label, probability: (1 - q) / others2.length }))],
      };
    };
    for (let i = 0; i < 400; i++) {
      const arms = [make("NATIVE"), make("TRANSLATED"), make("DIRECT")];
      const text = rng.pick(["water leak", "the lift is slow", "fire in the lift", "something", "garbage urgent"]);
      const forward = decideClassification({ rawText: text, arms, policy: defaultClassificationPolicy });
      const reversed = decideClassification({ rawText: text, arms: [...arms].reverse(), policy: defaultClassificationPolicy });
      expect({ ...reversed, reasons: [...reversed.reasons].sort() }).toEqual({ ...forward, reasons: [...forward.reasons].sort() });
    }
  });

  it("a complaint the safety rules know is never sent to triage, whatever the model says", () => {
    const rng = createPrng(5);
    for (let i = 0; i < 200; i++) {
      const arms: (ArmResult | null)[] = [rng.chance(0.5) ? null : { arm: "NATIVE", categories: [{ label: rng.pick(CATEGORY_CODES), probability: 1 }], urgencies: [{ label: "LOW", probability: 1 }] }];
      const decision = decideClassification({ rawText: rng.pick(["fire!", "आग लगी", "gas leak", "lift stuck", "shock laga"]), arms });
      expect(decision).toMatchObject({ needsTriage: false, urgency: "CRITICAL", escalateToDutyManager: true });
    }
  });
});
