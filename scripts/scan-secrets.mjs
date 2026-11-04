import { readdirSync, readFileSync, statSync } from "node:fs";
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

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (stat.size < 1_000_000) yield path;
  }
}

const findings = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  if (text.includes("\0")) continue;
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) findings.push(`${relative(ROOT, file)}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error(`Possible secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("scan:secrets: no secrets found");
