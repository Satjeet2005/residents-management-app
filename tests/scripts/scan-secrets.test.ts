import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/scan-secrets.mjs");
// Built at runtime so this file never matches a scanner pattern itself.
const FAKE_KEY = "sk" + "-" + "A".repeat(10) + "b".repeat(12);
const KEY_LABEL = "Anthropic or OpenAI style key";
let base = "";
let counter = 0;

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

/** A fresh git repository with a .gitignore that ignores .env* except .env.example. */
function repo(): string {
  const root = path.join(base, `repo${counter++}`);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.name", "Scan Test");
  git(root, "config", "user.email", "scan@example.invalid");
  writeFileSync(path.join(root, ".gitignore"), ".env*\n!.env.example\n");
  writeFileSync(path.join(root, ".env.example"), "API_KEY=your-key-here\n");
  git(root, "add", ".gitignore", ".env.example");
  return root;
}

function scan(cwd: string) {
  const result = spawnSync("node", [SCRIPT], { cwd });
  return { status: result.status, out: result.stdout.toString() + result.stderr.toString() };
}

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "scan-secrets-"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("scan-secrets", () => {
  it("SS1 an ignored .env holding a key-like value passes", () => {
    const root = repo();
    writeFileSync(path.join(root, ".env"), `KEY=${FAKE_KEY}\n`);
    const { status, out } = scan(root);
    expect(status).toBe(0);
    expect(out).toContain("scan mode: git file list");
    expect(out).toContain("scan:secrets: no secrets found");
  });

  it("SS2 a tracked file holding a key fails, naming the file and the label", () => {
    const root = repo();
    writeFileSync(path.join(root, "a.txt"), FAKE_KEY);
    git(root, "add", "a.txt");
    const { status, out } = scan(root);
    expect(status).toBe(1);
    expect(out).toContain(`a.txt: ${KEY_LABEL}`);
  });

  it("SS3 an untracked, not ignored file holding a key fails", () => {
    const root = repo();
    writeFileSync(path.join(root, "b.txt"), FAKE_KEY);
    expect(scan(root).status).toBe(1);
  });

  it("SS4 a .env that is not ignored fails with the hygiene message", () => {
    const root = repo();
    writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
    writeFileSync(path.join(root, ".env"), "KEY=placeholder\n");
    const { status, out } = scan(root);
    expect(status).toBe(1);
    expect(out).toContain(".env: an environment file is tracked or not ignored");
  });

  it("SS5 a tracked .env fails", () => {
    const root = repo();
    writeFileSync(path.join(root, ".env"), "KEY=placeholder\n");
    git(root, "add", "-f", ".env");
    const { status, out } = scan(root);
    expect(status).toBe(1);
    expect(out).toContain(".env: an environment file is tracked or not ignored");
  });

  it("SS6 .env.example with placeholders passes", () => {
    const { status, out } = scan(repo());
    expect(status).toBe(0);
    expect(out).toContain("scan:secrets: no secrets found");
  });

  it("SS7 a plain copy with no .git falls back to the walk and finds a key in a .env", () => {
    const root = repo();
    writeFileSync(path.join(root, ".env"), `KEY=${FAKE_KEY}\n`);
    const copy = path.join(base, `copy${counter++}`);
    cpSync(root, copy, { recursive: true, filter: (src) => path.basename(src) !== ".git" });
    const { status, out } = scan(copy);
    expect(status).toBe(1);
    expect(out).toContain("scan mode: directory walk");
    expect(out).toContain(`.env: ${KEY_LABEL}`);
  });

  it("SS8 a path that is listed but deleted from disk is skipped", () => {
    const root = repo();
    writeFileSync(path.join(root, "gone.txt"), "x");
    git(root, "add", "gone.txt");
    rmSync(path.join(root, "gone.txt"));
    expect(scan(root).status).toBe(0);
  });

  it("SS9 the output never contains the key value", () => {
    const root = repo();
    writeFileSync(path.join(root, "c.txt"), FAKE_KEY);
    expect(scan(root).out).not.toContain(FAKE_KEY);
  });
});
