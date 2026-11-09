import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Problem = { file: string; line: number; problem: string };
type Checker = {
  pathsIn: (line: string) => string[];
  citationsIn: (line: string) => { file: string; name: string }[];
  scriptsIn: (line: string) => string[];
  verify: (root: string) => Problem[];
};
let checker: Checker;
let root = "";

const put = (relative: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
};

beforeAll(async () => {
  checker = (await import(pathToFileURL(path.resolve("scripts/verify-doc-references.mjs")).href)) as Checker;
  root = mkdtempSync(path.join(tmpdir(), "docs-verify-"));
  put("package.json", JSON.stringify({ scripts: { check: "x", "db:seed": "y" } }));
  put("src/real.ts", "export {};\n");
  put("src/auth/otp-service.ts", "export {};\n");
  put("tests/real.test.ts", 'it("the real test name", () => {});\n');
  put("docs/sibling.md", "# sibling\n");
  put(
    "docs/a.md",
    [
      "Good: `src/real.ts`, `sibling.md`, a short name `otp-service.ts`, `auth/otp-service.ts` and `npm run check`.",
      "Bad path: `src/missing.ts`.",
      "Bad short name: `nowhere.ts`.",
      'Good citation: `tests/real.test.ts` :: "the real test name".',
      'Bad citation name: `tests/real.test.ts` :: "no such test".',
      'Bad citation file: `tests/gone.test.ts` :: "x".',
      "Bad script: `npm run nope`. Good script with a flag: npm run db:seed -- --yes.",
      "Skipped: `test-results/x.png`, `.cache/y.json`, `https://example.com/a.md`, `src/*.ts`, `<name>.ts`, `.env`.",
      "```",
      "`src/in-a-fence.ts` and npm run in-a-fence",
      "```",
    ].join("\n"),
  );
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A temporary git repository whose docs/a.md cites the given paths; `tracked` files are committed, the others are only on disk. */
function gitFixture(cited: string[], tracked: string[], untracked: string[], ignore = ""): { dir: string; problems: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), "docs-verify-git-"));
  const git = (...args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  const write = (relative: string): void => {
    mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    writeFileSync(path.join(dir, relative), "x\n");
  };
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(path.join(dir, "package.json"), "{}");
  writeFileSync(path.join(dir, ".gitignore"), ignore);
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs/a.md"), cited.map((c) => `See \`${c}\`.`).join("\n"));
  for (const f of tracked) write(f);
  git("add", "package.json", ".gitignore", "docs/a.md", ...tracked);
  git("commit", "-q", "-m", "fixture");
  for (const f of untracked) write(f);
  return { dir, problems: checker.verify(dir).map((p) => `${p.line} ${p.problem}`) };
}

describe("DV2 the documentation checker counts only committed files", () => {
  const dirs: string[] = [];
  const run = (...args: Parameters<typeof gitFixture>): string[] => {
    const result = gitFixture(...args);
    dirs.push(result.dir);
    return result.problems;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("accepts a cited tracked file", () => {
    expect(run(["docs/shot.png"], ["docs/shot.png"], [])).toEqual([]);
  });

  it("fails a cited file that is on disk but untracked", () => {
    expect(run(["docs/shot.png"], [], ["docs/shot.png"])).toEqual(["1 path exists but is not committed: docs/shot.png"]);
  });

  it("fails a cited ignored file", () => {
    expect(run(["docs/shot.png"], [], ["docs/shot.png"], "docs/shot.png\n")).toEqual(["1 path exists but is not committed: docs/shot.png"]);
  });

  it("accepts a cited local-only path that is allowlisted", () => {
    expect(run(["submission/notes.md"], [], ["submission/notes.md"], "submission/\n")).toEqual([]);
  });

  it("reports a cited file that exists nowhere as path not found", () => {
    expect(run(["docs/gone.png"], [], [])).toEqual(["1 path not found: docs/gone.png"]);
  });

  it("falls back to the disk check outside a git work tree", () => {
    const plain = mkdtempSync(path.join(tmpdir(), "docs-verify-plain-"));
    dirs.push(plain);
    writeFileSync(path.join(plain, "package.json"), "{}");
    mkdirSync(path.join(plain, "docs"));
    writeFileSync(path.join(plain, "docs/shot.png"), "x");
    writeFileSync(path.join(plain, "docs/a.md"), "See `docs/shot.png` and `docs/gone.png`.");
    expect(checker.verify(plain).map((p) => p.problem)).toEqual(["path not found: docs/gone.png"]);
  });
});

describe("DV1 the documentation checker", () => {
  it("reads backticked paths, citations and npm scripts from a line", () => {
    expect(checker.pathsIn("see `src/a.ts:12`, `docs/x.md#top` and `b.json`.")).toEqual(["src/a.ts", "docs/x.md", "b.json"]);
    expect(checker.pathsIn("`test-results/a.png` `src/*.ts` `<n>.ts` `https://x.y/z.md` `plain words`")).toEqual([]);
    expect(checker.citationsIn('`tests/a.test.ts` :: "name one" and `tests/b.test.ts` :: "name two"')).toEqual([
      { file: "tests/a.test.ts", name: "name one" },
      { file: "tests/b.test.ts", name: "name two" },
    ]);
    expect(checker.scriptsIn("run `npm run db:seed -- --yes` then npm run e2e.")).toEqual(["db:seed", "e2e"]);
  });

  it("reports exactly the problems of a small fixture, with the line numbers", () => {
    expect(checker.verify(root).map((p) => `${p.file}:${p.line} ${p.problem}`)).toEqual([
      "docs/a.md:2 path not found: src/missing.ts",
      "docs/a.md:3 path not found: nowhere.ts",
      'docs/a.md:5 test name not found in tests/real.test.ts: "no such test"',
      "docs/a.md:6 cited test file not found: tests/gone.test.ts",
      "docs/a.md:7 npm script not in package.json: nope",
    ]);
  });

  it("finds nothing in a repository whose documents are right", () => {
    const clean = mkdtempSync(path.join(tmpdir(), "docs-verify-clean-"));
    try {
      writeFileSync(path.join(clean, "package.json"), JSON.stringify({ scripts: { check: "x" } }));
      writeFileSync(path.join(clean, "README.md"), "Run `npm run check`. See `package.json`.\n");
      expect(checker.verify(clean)).toEqual([]);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  it("passes on this repository's own documents", () => {
    expect(checker.verify(process.cwd())).toEqual([]);
  });
});
