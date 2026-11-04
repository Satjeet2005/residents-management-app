import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HEADING = "## Project Safety Rules";
const COMMITS_HEADING = "## Commits";
const RULE_LINES = [
  "- Local git is allowed: `git status`, `git diff`, `git log`, `git show`, `git add <named files>`, `git restore --staged <files>`, `git commit`, and creating a new local branch.",
  "- Ask first, every time, before: `git push`, `git pull`, `git fetch`, `git merge`, `git rebase`, `git reset`, `git clean`, `git commit --amend`, `git stash`, any `--force` flag, deleting or creating branches or tags beyond a new local branch, editing remotes or git config, and `git init`.",
  "- Never rewrite or delete history that has been pushed.",
  "- Never stage with `git add -A` or `git add .`. Stage named files only, and review `git diff --staged` before every commit.",
  "- Before every commit run `npm run check` and `npm run scan:secrets`, and paste the output in the report. Never commit if either fails.",
  "- Never read the `.env` file. Instead, use `.env.example` as the reference for any environment-related activities.",
];

export function missingFromAgentDoc(text: string, required: string[] = [HEADING, ...RULE_LINES]): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  return required.filter((item) => !lines.includes(item));
}

function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  const body = pattern
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`${anchored ? "^" : "(^|/)"}${body}(/|$)`);
}

export function isIgnored(gitignore: string, filePath: string): boolean {
  let ignored = false;
  for (const raw of gitignore.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    if (globToRegExp(negated ? line.slice(1) : line).test(filePath)) ignored = !negated;
  }
  return ignored;
}

const DOCS_DIR = path.resolve(process.env.AGENT_DOCS_DIR ?? process.cwd());
const read = (name: string) => readFileSync(path.join(DOCS_DIR, name), "utf8");

describe("agent docs guard", () => {
  it.each(["CLAUDE.md", "AGENTS.md"])(
    "%s has the Project Safety Rules heading and all six rule lines verbatim",
    (file) => {
      expect(missingFromAgentDoc(read(file))).toEqual([]);
    },
  );

  it("CLAUDE.md has the Commits heading", () => {
    expect(missingFromAgentDoc(read("CLAUDE.md"), [COMMITS_HEADING])).toEqual([]);
  });

  it("reports a missing rule line", () => {
    const text = [HEADING, ...RULE_LINES.slice(0, -1)].join("\n");
    expect(missingFromAgentDoc(text)).toEqual([RULE_LINES[RULE_LINES.length - 1]]);
  });

  it("reports a missing heading", () => {
    expect(missingFromAgentDoc(RULE_LINES.join("\n"))).toEqual([HEADING]);
  });

  describe(".gitignore", () => {
    const gitignore = read(".gitignore");

    it("ignores .env", () => {
      expect(isIgnored(gitignore, ".env")).toBe(true);
    });

    it.each([".env.example", "AGENTS.md"])("does not ignore %s", (file) => {
      expect(isIgnored(gitignore, file)).toBe(false);
    });

    it("matcher treats a later negation as winning", () => {
      expect(isIgnored(".env*\n!.env.example\n", ".env.example")).toBe(false);
      expect(isIgnored(".env*\n", ".env.example")).toBe(true);
    });
  });
});
