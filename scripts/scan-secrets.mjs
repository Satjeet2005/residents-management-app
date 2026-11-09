import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage"]);
const SKIP_FILES = new Set([".env.example", "package-lock.json"]);

const PATTERNS = [
  { name: "private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "Anthropic or OpenAI style key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function inGitWorkTree() {
  const result = git(["rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && result.stdout.toString().trim() === "true";
}

/** Exactly the files git could commit: tracked plus untracked and not ignored. */
function gitFiles() {
  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(listed.stdout.toString().split("\0").filter(Boolean))]
    .filter((path) => existsSync(join(ROOT, path)))
    .map((path) => join(ROOT, path));
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (stat.size < 1_000_000) yield path;
  }
}

function* envFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* envFiles(path);
    else if ((entry === ".env" || entry.startsWith(".env.")) && entry !== ".env.example") yield path;
  }
}

/** Every environment file must be ignored and untracked. */
function hygieneFindings() {
  const findings = [];
  for (const file of envFiles(ROOT)) {
    const rel = relative(ROOT, file);
    const ignored = git(["check-ignore", "-q", "--", rel]).status === 0;
    const tracked = git(["ls-files", "--error-unmatch", "--", rel]).status === 0;
    if (!ignored || tracked) findings.push(`${rel}: an environment file is tracked or not ignored`);
  }
  return findings;
}

const gitMode = inGitWorkTree();
console.log(`scan mode: ${gitMode ? "git file list" : "directory walk"}`);

const findings = gitMode ? hygieneFindings() : [];
for (const file of gitMode ? gitFiles() : walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (rel.split("/").some((part) => SKIP_FILES.has(part)) && gitMode) continue;
  if (statSync(file).size >= 1_000_000) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes("\0")) continue;
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) findings.push(`${rel}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error(`Possible secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("scan:secrets: no secrets found");
