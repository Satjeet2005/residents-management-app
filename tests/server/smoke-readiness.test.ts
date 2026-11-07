import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** D112: both smoke scripts ask /api/health/ready first and stop, naming the failing check, before any login request. */

const READY = {
  status: "ok",
  checks: {
    config: { otpPepper: true, webhookSecret: true, demoMode: true, vercelSystemVars: false, nodeMajor: 24 },
    database: "ok",
    schema: { missingTables: [] },
    appRole: { isSuperuser: false, canInsertOtp: true, canUpdateLedger: false, canDeleteAuditLog: false },
    data: { seeded: true },
  },
};
const LEDGER_WRITABLE = { ...READY, status: "degraded", checks: { ...READY.checks, appRole: { ...READY.checks.appRole, canUpdateLedger: true } } };
const UNREACHABLE = { status: "degraded", checks: { config: READY.checks.config, database: "unreachable", schema: "skipped", appRole: "skipped", data: "skipped" } };

let server: http.Server;
let base = "";
let report: unknown = READY;
let reportStatus = 200;
let seen: string[] = [];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    if (request.url === "/api/health/ready") {
      response.writeHead(reportStatus, { "content-type": "application/json" }).end(JSON.stringify(report));
    } else {
      response.writeHead(404).end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function run(script: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [script, ...args], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk));
    child.on("close", (code) => resolve({ code, out }));
  });
}
const SCRIPTS: [string, () => string[]][] = [
  ["scripts/smoke-auth.mjs", () => [base, "5000000006"]],
  ["scripts/smoke-app.mjs", () => [base, "--as-of=real", "--demo=true"]],
];

describe("D112 the smoke scripts check readiness first", () => {
  it.each(SCRIPTS)("%s: a role that can update the ledger stops it before any other request, naming the check", async (script, args) => {
    report = LEDGER_WRITABLE;
    reportStatus = 503;
    seen = [];
    const { code, out } = await run(script, args());
    expect(code).toBe(1);
    expect(seen).toEqual(["GET /api/health/ready"]);
    expect(out).toContain("FAIL  appRole.canUpdateLedger");
    expect(out).toContain("Stopped before login: not ready (HTTP 503). Failing: appRole.canUpdateLedger.");
  });

  it.each(SCRIPTS)("%s: an unreachable database is named, and the skipped checks fail too", async (script, args) => {
    report = UNREACHABLE;
    reportStatus = 503;
    seen = [];
    const { code, out } = await run(script, args());
    expect(code).toBe(1);
    expect(seen).toEqual(["GET /api/health/ready"]);
    expect(out).toMatch(/FAIL\s+database\s+unreachable/);
    expect(out).toMatch(/FAIL\s+schema\s+skipped/);
  });

  it.each(SCRIPTS)("%s: a server with no readiness endpoint (404) stops with a plain message", async (script, args) => {
    report = {};
    reportStatus = 404;
    seen = [];
    const { code, out } = await run(script, args());
    expect(code).toBe(1);
    expect(seen).toEqual(["GET /api/health/ready"]);
    expect(out).toContain("Stopped before login");
  });

  it.each(SCRIPTS)("%s: a ready server prints the table and goes on to the login steps", async (script, args) => {
    report = READY;
    reportStatus = 200;
    seen = [];
    const { out } = await run(script, args());
    expect(out).toContain("READY: the deployment can sign someone in");
    expect(out).toMatch(/PASS\s+appRole.canUpdateLedger\s+false/);
    expect(out).toMatch(/INFO\s+config.demoMode\s+true/);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.some((line) => line.includes("/api/auth/otp/request") || line.includes("/api/health"))).toBe(true);
  });
});
