import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NUL_MESSAGE, hasNul, withoutNul } from "@/server/request-text";

const NUL = "\u0000";

describe("A-001 withoutNul", () => {
  it("accepts ordinary text, Devanagari and other control characters", () => {
    const schema = withoutNul(z.string().max(50));
    expect(schema.safeParse("Water leak under the sink").success).toBe(true);
    expect(schema.safeParse("पानी का रिसाव").success).toBe(true);
    expect(schema.safeParse("line one\nline two\ttabbed").success).toBe(true);
  });

  it("refuses a NUL anywhere in the text, with a plain-English message", () => {
    const schema = withoutNul(z.string().max(50));
    for (const text of [NUL, `${NUL}start`, `mid${NUL}dle`, `end${NUL}`]) {
      const result = schema.safeParse(text);
      expect(result.success, text).toBe(false);
      expect(result.error?.issues[0].message).toBe(NUL_MESSAGE);
    }
  });

  it("keeps the other rules of the chain and works with trim, optional and nullable", () => {
    const reason = withoutNul(z.string().trim().min(5).max(10));
    expect(reason.safeParse("  abcde  ").success).toBe(true);
    expect(reason.safeParse("abc").success).toBe(false);
    expect(reason.safeParse("abcdefghijkl").success).toBe(false);
    expect(withoutNul(z.string().max(5)).optional().safeParse(undefined).success).toBe(true);
    expect(withoutNul(z.string().max(5)).optional().safeParse(`a${NUL}`).success).toBe(false);
    expect(withoutNul(z.string().max(5)).nullable().safeParse(null).success).toBe(true);
  });

  it("hasNul sees only U+0000", () => {
    expect(hasNul("a\u0001b")).toBe(false);
    expect(hasNul("a\u0000b")).toBe(true);
  });
});

/**
 * Every request text field goes through withoutNul. This reads the source: each `z.string(` in src must be wrapped in withoutNul(...), be limited by
 * a pattern (.regex: digits, codes, ids), or be on this list with the reason it is not request text or has its own handling.
 */
const FILES_NOT_REQUEST_TEXT: Record<string, string> = {
  "server/statements/ui-data.ts": "reads stored decision and parsed-row JSON out of the database; nothing here comes from a request",
  "server/statements/review.ts": "reads stored decision JSON out of the database",
  "server/statements/approval.ts": "reads the stored JSON of a pending approval request out of the database",
  "lib/reports/cursor.ts": "the schema of a decoded ageing cursor; the cursor text is decoded by this strict parser and never reaches a query",
  "server/home/mapper.ts": "reads the society's bank settings out of the database",
  "server/payments/webhook.ts": "a gateway event whose HMAC signature is verified before it is parsed; the payments webhook is an audited area",
};
const FIELDS_WITH_OTHER_HANDLING: { file: string; needle: string; why: string }[] = [
  { file: "app/(staff)/staff/reconciliation/[importId]/actions.ts", needle: "cursor: z.string()", why: "a cursor decoded by a strict parser that rejects anything that is not its own encoding; it never reaches a query as text" },
  { file: "app/(staff)/staff/complaints/actions.ts", needle: "cursor: z.string()", why: "a cursor decoded by a strict parser (base64url, then a schema with a uuid and timestamps)" },
  { file: "app/(staff)/staff/complaints/actions.ts", needle: "q: z.string()", why: "a flat-code prefix: flatCodePrefix keeps only letters, digits and a hyphen, and returns null otherwise" },
  { file: "app/(staff)/staff/reports/actions.ts", needle: "cursor: z.string()", why: "a cursor decoded by a strict parser (src/lib/reports/cursor.ts) that rejects anything that is not its own encoding" },
  { file: "server/complaints/handlers.ts", needle: "body: z.string()", why: "the complaint text: a NUL is already handled (201, tests/integration/complaints-create.test.ts), and what works is not changed" },
  { file: "server/statements/handlers.ts", needle: "csv: z.string()", why: "a NUL in the CSV text is the documented 422 INVALID_CSV (StatementLimitError NUL_BYTES)" },
];

/** The expression of one `z.string(` call and what is chained on it, up to the comma, brace or bracket that ends the field. */
function chainFrom(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") {
      if (depth === 0) return source.slice(start, i);
      depth -= 1;
    } else if (depth === 0 && (char === "," || char === "}" || char === ";" || char === "\n")) return source.slice(start, i);
  }
  return source.slice(start);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "seed" && dir.endsWith("domain") ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("A-001 every request text field refuses NUL (source scan)", () => {
  const root = join(process.cwd(), "src");
  const offenders: string[] = [];
  let seen = 0;
  for (const path of sourceFiles(root)) {
    const file = relative(root, path).split("\\").join("/");
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (comment) => " ".repeat(comment.length));
    for (let at = source.indexOf("z.string("); at !== -1; at = source.indexOf("z.string(", at + 1)) {
      seen += 1;
      const chain = chainFrom(source, at);
      const wrapped = source.slice(Math.max(0, at - 11), at) === "withoutNul(";
      const lineStart = source.lastIndexOf("\n", at) + 1;
      const line = source.slice(lineStart, source.indexOf("\n", at));
      const allowed = Object.hasOwn(FILES_NOT_REQUEST_TEXT, file) || FIELDS_WITH_OTHER_HANDLING.some((entry) => entry.file === file && line.includes(entry.needle));
      if (!wrapped && !chain.includes(".regex(") && !allowed) offenders.push(`${file}: ${chain.slice(0, 80)}`);
    }
  }

  it("finds the schemas (the scan is not empty)", () => {
    expect(seen).toBeGreaterThan(25);
  });

  it("every z.string() is wrapped in withoutNul, limited by a pattern, or on the short allowlist", () => {
    expect(offenders).toEqual([]);
  });

  it("every allowlist entry still matches something (a stale entry would hide a gap)", () => {
    for (const file of Object.keys(FILES_NOT_REQUEST_TEXT)) expect(readFileSync(join(root, file), "utf8")).toContain("z.string(");
    for (const entry of FIELDS_WITH_OTHER_HANDLING) expect(readFileSync(join(root, entry.file), "utf8"), `${entry.file} ${entry.needle}`).toContain(entry.needle);
  });
});
