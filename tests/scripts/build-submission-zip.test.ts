import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/build-submission-zip.sh");
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const GOOD_TOP = "Technical design. Code: https://github.com/example/township. Live: https://township.example.app. Then the rest of the document.";
let base = "";
let counter = 0;

/** A fresh fixture repository: a clean deployment.md, a README.md and one screenshot. */
function fixture(): string {
  const root = path.join(base, `repo${counter++}`);
  mkdirSync(path.join(root, "docs", "screenshots"), { recursive: true });
  writeFileSync(path.join(root, "deployment.md"), "# Deployment\n\nNo placeholders here.\n");
  writeFileSync(path.join(root, "README.md"), "# Readme\n");
  writeFileSync(path.join(root, "docs", "screenshots", "a.png"), "png");
  return root;
}

/** A small .docx made with Python's zipfile: one word/document.xml with the text in a paragraph. */
function docx(file: string, text: string): void {
  const code = `import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], "w") as z:\n    z.writestr("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>' + sys.argv[2] + '</w:t></w:r></w:p></w:body></w:document>')\n`;
  const made = spawnSync("python3", ["-c", code, file, text]);
  if (made.status !== 0) throw new Error(`could not build the docx: ${made.stderr.toString()}`);
}

function run(args: string[], env: Record<string, string> = {}, cwd = base) {
  const result = spawnSync("bash", [SCRIPT, ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const entriesOf = (zip: string): string[] => {
  const listed = spawnSync("python3", ["-c", "import sys, zipfile\nprint('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", zip], { encoding: "utf8" });
  return listed.stdout.split("\n").filter(Boolean);
};
const zipsIn = (root: string): string[] => (existsSync(path.join(root, "submission")) ? readdirSync(path.join(root, "submission")).filter((f) => f.endsWith(".zip")) : []);

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "submission-test-"));
  if (!hasPython) console.warn("SKIPPED: python3 is not installed, so the .docx fixtures cannot be built");
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe.skipIf(!hasPython)("SZ1 the submission zip builder", () => {
  it("succeeds with both addresses at the top and no placeholder: the zip holds exactly two entries", () => {
    const root = fixture();
    const tdd = path.join(base, "good.docx");
    docx(tdd, GOOD_TOP);
    const result = run([tdd], { SUBMISSION_ROOT: root });
    expect(result.code, result.out).toBe(0);
    const [zip] = zipsIn(root);
    expect(zip).toMatch(/^township-submission-\d{8}-\d{4}\.zip$/);
    expect(entriesOf(path.join(root, "submission", zip)).sort()).toEqual(["deployment.md", "good.docx"]);
    expect(result.out).toMatch(/sha256: [0-9a-f]{64}/);
    expect(result.out).toContain("deployment.md");
  });

  it("with --with-screenshots it also holds docs/screenshots, and never without it", () => {
    const root = fixture();
    const tdd = path.join(base, "shots.docx");
    docx(tdd, GOOD_TOP);
    expect(run([tdd, "--with-screenshots"], { SUBMISSION_ROOT: root }).code).toBe(0);
    expect(entriesOf(path.join(root, "submission", zipsIn(root)[0])).sort()).toEqual(["deployment.md", "docs/screenshots/a.png", "shots.docx"]);
  });

  it("fails, naming the file and the line, when deployment.md still has a placeholder, and writes nothing", () => {
    const root = fixture();
    writeFileSync(path.join(root, "deployment.md"), "# Deployment\n\nOpen <LIVE_URL> now.\n");
    const tdd = path.join(base, "placeholder.docx");
    docx(tdd, GOOD_TOP);
    const result = run([tdd], { SUBMISSION_ROOT: root });
    expect(result.code).toBe(1);
    expect(result.out).toContain("deployment.md:3:");
    expect(zipsIn(root)).toEqual([]);
  });

  it("only warns when README.md has a placeholder", () => {
    const root = fixture();
    writeFileSync(path.join(root, "README.md"), "Live: <LIVE_URL>\n");
    const tdd = path.join(base, "readme.docx");
    docx(tdd, GOOD_TOP);
    const result = run([tdd], { SUBMISSION_ROOT: root });
    expect(result.code).toBe(0);
    expect(result.out).toContain("WARN: README.md still has a placeholder");
  });

  it("fails when the GitHub address is missing from the first 2,000 characters", () => {
    const root = fixture();
    const tdd = path.join(base, "nogit.docx");
    docx(tdd, `${"x".repeat(2100)} https://github.com/example/township and https://township.example.app`);
    const result = run([tdd], { SUBMISSION_ROOT: root });
    expect(result.code).toBe(1);
    expect(result.out).toContain("no github.com address");
  });

  it("fails when the live link is missing", () => {
    const root = fixture();
    const tdd = path.join(base, "nolive.docx");
    docx(tdd, "Code: https://github.com/example/township and nothing else.");
    const result = run([tdd], { SUBMISSION_ROOT: root });
    expect(result.code).toBe(1);
    expect(result.out).toContain("no live link");
  });

  it("asks for a manual check, and goes on, when the text of a pdf cannot be read", () => {
    const root = fixture();
    const tdd = path.join(base, "fake.pdf");
    writeFileSync(tdd, "this is a text file named .pdf, not a real PDF");
    const result = run([tdd], { SUBMISSION_ROOT: root });
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("MANUAL CHECK: confirm the GitHub URL and the live link are at the very top of the TDD");
    expect(entriesOf(path.join(root, "submission", zipsIn(root)[0])).sort()).toEqual(["deployment.md", "fake.pdf"]);
  });

  it("exits 2 when the TDD file is missing, has another extension, or deployment.md is missing", () => {
    const root = fixture();
    expect(run([path.join(base, "none.docx")], { SUBMISSION_ROOT: root }).code).toBe(2);
    const text = path.join(base, "notes.txt");
    writeFileSync(text, "x");
    expect(run([text], { SUBMISSION_ROOT: root }).code).toBe(2);
    const empty = path.join(base, "emptyroot");
    mkdirSync(empty);
    const tdd = path.join(base, "orphan.docx");
    docx(tdd, GOOD_TOP);
    expect(run([tdd], { SUBMISSION_ROOT: empty }).code).toBe(2);
    expect(run([], { SUBMISSION_ROOT: root }).code).toBe(2);
  });

  it("warns above the warn size and fails above the fail size (limits set through the environment), removing the archive", () => {
    const root = fixture();
    const tdd = path.join(base, "size.docx");
    docx(tdd, GOOD_TOP);
    const warned = run([tdd], { SUBMISSION_ROOT: root, SUBMISSION_WARN_BYTES: "10" });
    expect(warned.code).toBe(0);
    expect(warned.out).toContain("WARN: the archive is over 10 bytes");
    const root2 = fixture();
    const failed = run([tdd], { SUBMISSION_ROOT: root2, SUBMISSION_FAIL_BYTES: "10" });
    expect(failed.code).toBe(1);
    expect(failed.out).toContain("FAIL: the archive is over 10 bytes");
    expect(zipsIn(root2)).toEqual([]);
  });

  it("finds the repository root from any directory inside the repository", () => {
    const tdd = path.join(base, "anywhere.docx");
    docx(tdd, GOOD_TOP);
    const repo = path.resolve(".");
    for (const sub of ["scripts", "src/domain"]) {
      const result = run([tdd, "--check-only"], {}, path.join(repo, sub));
      expect(result.out, sub).toContain(`repository root: ${repo}`);
    }
  });
});
