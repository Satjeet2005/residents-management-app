// Checks the documentation against the repository:  npm run docs:verify
// For every markdown file in docs/ (and below), the root README.md and deployment.md it checks that
//   1. each backticked repository path exists (a path that starts with src/, tests/, docs/, scripts/, prisma/, public/, .github/ or generated/, or a file name with a
//      known extension). A short name such as `otp-service.ts` or `auth/otp.ts` is accepted when some file of the repository ends with it, and a name may also be relative to the document's folder;
//   2. each citation written as  `tests/x.test.ts` :: "test name"  names a test file that exists and contains that name;
//   3. each `npm run <name>` is a script in package.json.
// It prints one line per problem and exits 1 when there is any. It has no dependency. Paths that are produced when something runs (test-results/, .cache/, node_modules/, .next/) are skipped.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOTS = ["src/", "tests/", "docs/", "scripts/", "prisma/", "public/", ".github/", "generated/"];
const EXTENSIONS = /\.(md|ts|tsx|mjs|json|sh|prisma|css|sql|png|yml|yaml)$/;
const RUNTIME = ["test-results/", ".cache/", "node_modules/", ".next/", "playwright-report/"];
const SKIP_CHARS = /[\s*<>{}$=|'"]|^https?:|^\.\.\.|^~/;

/** The backticked tokens of a line that look like a repository path, without a trailing `:line` or punctuation. */
export function pathsIn(line) {
  const out = [];
  for (const match of line.matchAll(/`([^`]+)`/g)) {
    let token = match[1].trim().replace(/[.,;:)]+$/, "").replace(/:\d+(-\d+)?$/, "").replace(/#.*$/, "");
    if (token === "" || SKIP_CHARS.test(token) || RUNTIME.some((r) => token.startsWith(r))) continue;
    if (ROOTS.some((r) => token.startsWith(r)) || (EXTENSIONS.test(token) && !token.includes(" "))) out.push(token);
  }
  return out;
}

/** The `file.test.ts` :: "name" citations of a line. */
export function citationsIn(line) {
  return [...line.matchAll(/`([^`\s]+\.test\.ts)`\s*::\s*"([^"]+)"/g)].map((m) => ({ file: m[1], name: m[2] }));
}

/** The npm script names of a line. */
export function scriptsIn(line) {
  return [...line.matchAll(/npm run ([A-Za-z0-9:_.-]+)/g)].map((m) => m[1].replace(/[.:,;)]+$/, "")).filter((n) => n !== "");
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "test-results", ".cache", "playwright-report"]);

/** Every file of the repository as a path with forward slashes, to find a document's short names ("otp-service.ts", "auth/otp.ts"). */
function repositoryFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir))) {
      if (IGNORED_DIRS.has(entry)) continue;
      const rel = dir === "" ? entry : `${dir}/${entry}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk("");
  return files;
}

function markdownFiles(root) {
  const files = ["README.md", "deployment.md"].filter((f) => existsSync(path.join(root, f)));
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, entry);
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith(".md")) files.push(rel);
    }
  };
  if (existsSync(path.join(root, "docs"))) walk("docs");
  return files.sort();
}

/** All the problems of the documents under `root`: { file, line, problem }. */
export function verify(root) {
  const problems = [];
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const all = repositoryFiles(root);
  for (const file of markdownFiles(root)) {
    const lines = readFileSync(path.join(root, file), "utf8").split("\n");
    let fenced = false;
    lines.forEach((text, index) => {
      if (text.trimStart().startsWith("```")) {
        fenced = !fenced;
        return;
      }
      const at = (problem) => problems.push({ file, line: index + 1, problem });
      const citedHere = new Set(citationsIn(text).map((c) => c.file));
      for (const token of fenced ? [] : pathsIn(text)) {
        if (citedHere.has(token)) continue; // the citation check below reports a missing file once
        const candidates = [path.join(root, token), path.join(root, path.dirname(file), token)];
        const rooted = ROOTS.some((r) => token.startsWith(r));
        const shortName = !rooted && !token.startsWith(".") ? all.some((f) => f === token || f.endsWith(`/${token}`)) : false;
        if (!candidates.some((c) => existsSync(c)) && !shortName) at(`path not found: ${token}`);
      }
      for (const { file: cited, name } of citationsIn(text)) {
        const full = path.join(root, cited);
        if (!existsSync(full)) at(`cited test file not found: ${cited}`);
        else if (!readFileSync(full, "utf8").includes(name)) at(`test name not found in ${cited}: "${name}"`);
      }
      for (const name of fenced ? [] : scriptsIn(text)) if (!scripts.has(name)) at(`npm script not in package.json: ${name}`);
    });
  }
  return problems;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = verify(process.cwd());
  for (const p of problems) console.log(`${p.file}:${p.line}: ${p.problem}`);
  console.log(problems.length === 0 ? "docs:verify: every path, test citation and npm script in the documents exists" : `docs:verify: ${problems.length} problem(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
