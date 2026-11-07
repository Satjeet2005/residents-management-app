import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * D81 for pages: every page under src/app asks requireUser for the signed-in person itself, because the Next.js
 * authentication guide says checks belong in each page and close to the data, and a layout does not run again when a
 * person moves between pages. The public pages are an allowlist, one reason each. A layout may not do the check.
 */
const APP = path.resolve(process.cwd(), "src/app");

/** The pages that are public on purpose. */
const PUBLIC_PAGES: Record<string, string> = {
  "/login": "Where a person who is not signed in logs in.",
  "/forbidden": "Where requireUser sends a person whose role does not allow a page; it needs no session.",
  "/design": "The design reference, hidden (404) unless SHOW_DESIGN_PAGE is true.",
};

function files(dir: string, name: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? [] : files(full, name);
    return name.test(entry.name) ? [full] : [];
  });
}

/** "/profile" for src/app/(resident)/profile/page.tsx; route groups in brackets are not part of the address. */
const addressOf = (file: string): string => {
  const parts = path.relative(APP, path.dirname(file)).split(path.sep).filter((p) => p !== "." && !/^\(.*\)$/.test(p));
  return `/${parts.join("/")}`;
};

/** The names of the functions a source file calls. */
export function callsIn(source: string): Set<string> {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.add(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

describe("D81 page inventory", () => {
  const pages = files(APP, /^page\.tsx$/).map((file) => ({ file, address: addressOf(file), calls: callsIn(readFileSync(file, "utf8")) }));

  it("finds the pages", () => {
    expect(pages.map((p) => p.address).sort()).toEqual(expect.arrayContaining(["/", "/profile", "/staff", "/staff/reconciliation", "/login", "/forbidden", "/design"]));
  });

  it("every page that is not on the public allowlist calls requireUser", () => {
    const unguarded = pages.filter((p) => !(p.address in PUBLIC_PAGES) && !p.calls.has("requireUser")).map((p) => p.address);
    expect(unguarded, "these pages are not guarded: call requireUser, or add them to PUBLIC_PAGES with a reason").toEqual([]);
  });

  it("T12c the staff pages ask for a role: /staff for any active staff, every reconciliation page for payments:match (the data loaders check it again)", () => {
    const need = (address: string): string | null => {
      const page = pages.find((p) => p.address === address);
      return page === undefined ? null : (/need:\s*"([^"]+)"/.exec(readFileSync(page.file, "utf8"))?.[1] ?? null);
    };
    expect(need("/staff")).toBe("STAFF");
    const reconciliation = pages.filter((p) => p.address.startsWith("/staff/reconciliation"));
    expect(reconciliation.length).toBeGreaterThanOrEqual(1);
    for (const page of reconciliation) expect(need(page.address), page.address).toBe("payments:match");
  });

  it("T13c the staff complaints pages ask for complaints:manage and call requireUser themselves (the loaders check it again)", () => {
    const staffComplaints = pages.filter((p) => p.address.startsWith("/staff/complaints"));
    expect(staffComplaints.map((p) => p.address).sort()).toEqual(["/staff/complaints", "/staff/complaints/[id]"]);
    for (const page of staffComplaints) {
      expect(page.calls.has("requireUser"), page.address).toBe(true);
      expect(/need:\s*"complaints:manage"/.test(readFileSync(page.file, "utf8")), page.address).toBe(true);
    }
  });

  it("T13b the complaint pages ask for a resident (a staff member is sent to /forbidden) and call requireUser themselves", () => {
    const complaintPages = ["/complaints", "/complaints/new", "/complaints/[id]"];
    expect(pages.map((p) => p.address)).toEqual(expect.arrayContaining(complaintPages));
    for (const address of complaintPages) {
      const page = pages.find((p) => p.address === address);
      expect(page?.calls.has("requireUser"), address).toBe(true);
      expect(/need:\s*"RESIDENT"/.test(readFileSync(page?.file ?? "", "utf8")), address).toBe(true);
    }
  });

  it("every public page on the allowlist exists (no stale entry)", () => {
    const present = new Set(pages.map((p) => p.address));
    expect(Object.keys(PUBLIC_PAGES).filter((a) => !present.has(a))).toEqual([]);
  });

  it("a layout does not perform the auth check itself", () => {
    const layouts = files(APP, /^layout\.tsx$/).map((file) => ({ file: path.relative(process.cwd(), file), calls: callsIn(readFileSync(file, "utf8")) }));
    expect(layouts.length).toBeGreaterThanOrEqual(3);
    const checking = layouts.filter((l) => l.calls.has("requireUser") || l.calls.has("getCurrentUser") || l.calls.has("cookies")).map((l) => l.file);
    expect(checking).toEqual([]);
  });

  it("the checker finds a call and ignores a mention", () => {
    expect(callsIn("const user = await requireUser({});").has("requireUser")).toBe(true);
    expect(callsIn("// requireUser\nconst x = 'requireUser';").has("requireUser")).toBe(false);
  });
});
