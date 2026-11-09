import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** D112: both smoke scripts ask /api/health/ready first and stop, naming the failing check, before any login request. */

const READY = {
  status: "ok",
  checks: {
    config: { otpPepper: true, webhookSecret: true, demoMode: true, demoAsOf: true, opsTestEnabled: false, vercelSystemVars: false, nodeMajor: 24 },
    database: "ok",
    schema: { missingTables: [] },
    appRole: { isSuperuser: false, canInsertOtp: true, canUpdateLedger: false, canDeleteAuditLog: false, canInsertErrorEvents: true, canReadErrorEvents: false },
    data: { seeded: true },
  },
};
const LEDGER_WRITABLE = { ...READY, status: "degraded", checks: { ...READY.checks, appRole: { ...READY.checks.appRole, canUpdateLedger: true } } };
const ERRORS_READABLE = { ...READY, status: "degraded", checks: { ...READY.checks, appRole: { ...READY.checks.appRole, canReadErrorEvents: true } } };
const ERRORS_NOT_WRITABLE = { ...READY, status: "degraded", checks: { ...READY.checks, appRole: { ...READY.checks.appRole, canInsertErrorEvents: false } } };
const OWNER_ROLE = {
  ...READY,
  status: "degraded",
  checks: { ...READY.checks, appRole: { isSuperuser: true, canInsertOtp: true, canUpdateLedger: true, canDeleteAuditLog: true, canInsertErrorEvents: true, canReadErrorEvents: true } },
};
const OWNER_ROLE_AND_NO_SEED = { ...OWNER_ROLE, checks: { ...OWNER_ROLE.checks, data: { seeded: false } } };
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

  it.each(SCRIPTS)("%s: an app role that can READ error events (D136) stops it, naming the check", async (script, args) => {
    report = ERRORS_READABLE;
    reportStatus = 503;
    seen = [];
    const { code, out } = await run(script, args());
    expect(code).toBe(1);
    expect(seen).toEqual(["GET /api/health/ready"]);
    expect(out).toContain("FAIL  appRole.canReadErrorEvents");
    expect(out).toContain("Failing: appRole.canReadErrorEvents.");
  });

  it.each(SCRIPTS)("%s: an app role that cannot INSERT error events stops it, naming the check", async (script, args) => {
    report = ERRORS_NOT_WRITABLE;
    reportStatus = 503;
    seen = [];
    const { out } = await run(script, args());
    expect(out).toContain("FAIL  appRole.canInsertErrorEvents");
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
    expect(out).toMatch(/INFO\s+config.demoAsOf\s+true/);
    expect(out).not.toMatch(/WARN/);
    expect(out).toMatch(/INFO\s+config.opsTestEnabled\s+false/);
    expect(out).toMatch(/PASS\s+appRole.canInsertErrorEvents\s+true/);
    expect(out).toMatch(/PASS\s+appRole.canReadErrorEvents\s+false/);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.some((line) => line.includes("/api/auth/otp/request") || line.includes("/api/health"))).toBe(true);
  });
});

describe("D229 a DEMO_AS_OF that is ignored shows as a warning row, not a failure", () => {
  it.each(SCRIPTS)("%s: prints WARN and still goes on", async (script, args) => {
    report = { ...READY, checks: { ...READY.checks, config: { ...READY.checks.config, demoMode: false, demoAsOf: false } }, warnings: ["demoAsOfIgnored"] };
    reportStatus = 200;
    seen = [];
    const { out } = await run(script, args());
    expect(out).toMatch(/WARN\s+warning\s+DEMO_AS_OF is set but demo mode is off/);
    expect(out).toContain("READY: the deployment can sign someone in");
  });
});

describe("D136 --allow-owner-role is for local development only", () => {
  const FLAG = "--allow-owner-role";
  const withFlag = (args: string[]) => [...args, FLAG];

  it.each(SCRIPTS)("%s: without the flag an owner connection is stopped, exactly as before", async (script, args) => {
    report = OWNER_ROLE;
    reportStatus = 503;
    seen = [];
    const { code, out } = await run(script, args());
    expect(code).toBe(1);
    expect(seen).toEqual(["GET /api/health/ready"]);
    expect(out).toContain("Failing: appRole.isSuperuser, appRole.canUpdateLedger, appRole.canDeleteAuditLog, appRole.canReadErrorEvents.");
    expect(out).not.toContain("WARNING");
  });

  it.each(SCRIPTS)("%s: with the flag on 127.0.0.1 it prints a loud warning and goes on to the login steps", async (script, args) => {
    report = OWNER_ROLE;
    reportStatus = 503;
    seen = [];
    const { out } = await run(script, withFlag(args()));
    expect(out).toContain("!!! WARNING: --allow-owner-role is set");
    expect(out).toContain("ONLY");
    expect(seen.length).toBeGreaterThan(1);
  });

  it.each(SCRIPTS)("%s: with the flag, any other failure still stops it (an unseeded database, an unreachable one)", async (script, args) => {
    for (const bad of [OWNER_ROLE_AND_NO_SEED, UNREACHABLE]) {
      report = bad;
      reportStatus = 503;
      seen = [];
      const { code, out } = await run(script, withFlag(args()));
      expect(code).toBe(1);
      expect(seen).toEqual(["GET /api/health/ready"]);
      expect(out).not.toContain("--allow-owner-role is set");
    }
  });

  it.each(SCRIPTS)("%s: with the flag and a base URL that is not localhost or 127.0.0.1 it is refused before any request", async (script) => {
    seen = [];
    for (const remote of ["https://township.example.test", "http://localhost.evil.test:3000", "http://127.0.0.1.evil.test", "http://127.0.0.2:3000", "http://[::1]:3000"]) {
      const { code, out } = await run(script, remote.startsWith("http") && script.includes("auth") ? [remote, "5000000006", FLAG] : [remote, "--as-of=real", "--demo=true", FLAG]);
      expect(code, remote).toBe(1);
      expect(out, remote).toContain("REFUSED --allow-owner-role");
      expect(out, remote).not.toContain("GET /api/health/ready answered");
    }
    expect(seen).toEqual([]);
  });

  it.each(SCRIPTS)("%s: with the flag a fully ready server prints no warning", async (script, args) => {
    report = READY;
    reportStatus = 200;
    seen = [];
    const { out } = await run(script, withFlag(args()));
    expect(out).toContain("READY: the deployment can sign someone in");
    expect(out).not.toContain("WARNING");
  });
});
