import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * D81: every route file under src/app/api exports each HTTP method as `export const METHOD = withPermission(...)`
 * or `= publicRoute(...)`. A bare handler (`export async function POST`) fails here, with its path and method, so a
 * new route cannot ship unguarded. The wrappers are in src/server/auth/guard.ts. Checks happen where the data is
 * used (Next.js authentication guide), and no proxy or middleware is relied on.
 */

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const API_DIR = path.resolve(process.cwd(), "src/app/api");

/** The routes that are public on purpose, with the reason. Adding a line here is a security decision. */
const PUBLIC_ROUTES: Record<string, string[]> = {
  // Health check for the host and the smoke test; it reveals nothing.
  "/api/health": ["GET"],
  // A person who is not signed in asks for a one-time code. Always the same answer for any valid phone (no account leak).
  "/api/auth/otp/request": ["POST"],
  // The person proves they hold the code; this is how a session starts.
  "/api/auth/otp/verify": ["POST"],
  // Logging out is idempotent: 204 with or without a session, and it always clears the cookie.
  "/api/auth/logout": ["POST"],
};

type Wrapper = "withPermission" | "publicRoute" | "bare";
type Finding = { method: string; wrapper: Wrapper };

/** What a route file exports, and which imports and names it uses. Exported so the checker itself can be tested. */
export function inspectRoute(source: string): { exports: Finding[]; imports: string[]; names: Set<string> } {
  const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const imports: string[] = [];
  const names = new Set<string>();
  const hasExport = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  };
  visit(file);

  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExport(statement) && statement.name && HTTP_METHODS.includes(statement.name.text)) {
      found.push({ method: statement.name.text, wrapper: "bare" });
    } else if (ts.isVariableStatement(statement) && hasExport(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !HTTP_METHODS.includes(declaration.name.text)) continue;
        const init = declaration.initializer;
        const callee = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) ? init.expression.text : "";
        found.push({ method: declaration.name.text, wrapper: callee === "withPermission" || callee === "publicRoute" ? callee : "bare" });
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (HTTP_METHODS.includes(element.name.text)) found.push({ method: element.name.text, wrapper: "bare" });
      }
    }
  }
  return { exports: found, imports, names };
}

const FORBIDDEN_IMPORTS = ["@/server/auth/session-service", "@/server/auth/cookie", "next/headers"];
const FORBIDDEN_NAMES = ["resolveSession", "cookies", "readSessionToken"];

/** The problems in one route file, each naming the route and method. */
export function violationsIn(route: string, source: string): string[] {
  const { exports, imports, names } = inspectRoute(source);
  const problems: string[] = [];
  if (exports.length === 0) problems.push(`${route}: exports no HTTP method`);
  for (const { method, wrapper } of exports) {
    if (wrapper === "bare") problems.push(`${route} ${method}: not wrapped in withPermission(...) or publicRoute(...)`);
    if (wrapper === "publicRoute" && !(PUBLIC_ROUTES[route] ?? []).includes(method)) problems.push(`${route} ${method}: publicRoute but not in the public allowlist`);
    if (wrapper === "withPermission" && (PUBLIC_ROUTES[route] ?? []).includes(method)) problems.push(`${route} ${method}: in the public allowlist but guarded`);
  }
  for (const specifier of imports) if (FORBIDDEN_IMPORTS.includes(specifier)) problems.push(`${route}: imports ${specifier}; routes must not read the session or cookies themselves`);
  for (const name of FORBIDDEN_NAMES) if (names.has(name)) problems.push(`${route}: uses ${name}; routes must not read the session or cookies themselves`);
  return problems;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const toRoute = (file: string): string => `/api${path.dirname(path.relative(API_DIR, file)).split(path.sep).filter((s) => s !== ".").map((s) => `/${s}`).join("")}`;

describe("D81 route inventory", () => {
  const files = routeFiles(API_DIR);

  it("finds the route files", () => {
    expect(files.map(toRoute).sort()).toEqual(
      ["/api/auth/logout", "/api/auth/logout-all", "/api/auth/otp/request", "/api/auth/otp/verify", "/api/health", "/api/me"].sort(),
    );
  });

  it("every exported method of every route is wrapped, and no route reads the session or cookies itself", () => {
    const problems = files.flatMap((file) => violationsIn(toRoute(file), readFileSync(file, "utf8")));
    expect(problems).toEqual([]);
  });

  it("every allowlisted public route exists and is exported as publicRoute (the allowlist has no stale entries)", () => {
    const actual = new Map(files.map((file) => [toRoute(file), inspectRoute(readFileSync(file, "utf8")).exports]));
    for (const [route, methods] of Object.entries(PUBLIC_ROUTES)) {
      for (const method of methods) {
        expect(actual.get(route)?.find((e) => e.method === method)?.wrapper, `${route} ${method}`).toBe("publicRoute");
      }
    }
  });

  it("the only public routes are the four on the allowlist plus nothing else", () => {
    const publicOnes = files.flatMap((file) => inspectRoute(readFileSync(file, "utf8")).exports.filter((e) => e.wrapper === "publicRoute").map((e) => `${e.method} ${toRoute(file)}`));
    expect(publicOnes.sort()).toEqual(["GET /api/health", "POST /api/auth/logout", "POST /api/auth/otp/request", "POST /api/auth/otp/verify"]);
  });
});

describe("D81 the inventory checker itself", () => {
  const route = "/api/x";
  const guarded = (body: string) => `import { withPermission, publicRoute } from "@/server/auth/guard";\n${body}`;

  it.each<[string, string, string[]]>([
    ["a bare async function", "export async function GET() { return Response.json({}); }", ["/api/x GET: not wrapped in withPermission(...) or publicRoute(...)"]],
    ["a bare function", "export function POST() { return Response.json({}); }", ["/api/x POST: not wrapped in withPermission(...) or publicRoute(...)"]],
    ["a bare arrow function", "export const DELETE = async () => Response.json({});", ["/api/x DELETE: not wrapped in withPermission(...) or publicRoute(...)"]],
    ["a re-export", "const GET = () => Response.json({}); export { GET };", ["/api/x GET: not wrapped in withPermission(...) or publicRoute(...)"]],
    ["an alias for the wrapper", "const w = withPermission; export const GET = w('ANY_USER', () => Response.json({}));", ["/api/x GET: not wrapped in withPermission(...) or publicRoute(...)"]],
    ["a wrapper called on a member", "export const GET = guards.withPermission('ANY_USER', () => Response.json({}));", ["/api/x GET: not wrapped in withPermission(...) or publicRoute(...)"]],
    ["a guarded method", "export const GET = withPermission('ANY_USER', () => Response.json({}));", []],
    ["a guarded method with a permission", "export const POST = withPermission('payments:match', async () => Response.json({}));", []],
    ["two methods, one bare", "export const GET = withPermission('STAFF', () => Response.json({}));\nexport async function PUT() { return new Response(); }", ["/api/x PUT: not wrapped in withPermission(...) or publicRoute(...)"]],
    ["a public route that is not allowlisted", "export const GET = publicRoute(() => Response.json({}));", ["/api/x GET: publicRoute but not in the public allowlist"]],
    ["no HTTP method", "export const runtime = 'nodejs';", ["/api/x: exports no HTTP method"]],
    ["an exported helper that is not a method", "export const helper = () => 1;\nexport const GET = withPermission('ANY_USER', () => Response.json({}));", []],
  ])("%s", (_label, body, expected) => {
    expect(violationsIn(route, guarded(body))).toEqual(expected);
  });

  it("flags a route that imports resolveSession, the cookie helpers or next/headers, or uses cookies()", () => {
    const source = `import { withPermission } from "@/server/auth/guard";
import { resolveSession } from "@/server/auth/session-service";
import { cookies } from "next/headers";
export const GET = withPermission('ANY_USER', async () => { await cookies(); return Response.json({}); });`;
    const problems = violationsIn(route, source);
    expect(problems).toEqual(
      expect.arrayContaining([
        "/api/x: imports @/server/auth/session-service; routes must not read the session or cookies themselves",
        "/api/x: imports next/headers; routes must not read the session or cookies themselves",
        "/api/x: uses resolveSession; routes must not read the session or cookies themselves",
        "/api/x: uses cookies; routes must not read the session or cookies themselves",
      ]),
    );
  });

  it("flags a public-allowlisted route that is guarded instead", () => {
    expect(violationsIn("/api/health", guarded("export const GET = withPermission('ANY_USER', () => Response.json({}));"))).toEqual([
      "/api/health GET: in the public allowlist but guarded",
    ]);
  });
});
