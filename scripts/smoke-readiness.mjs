// The readiness step shared by smoke-auth.mjs and smoke-app.mjs (D112). No dependencies: Node 24's fetch.
// It asks GET /api/health/ready first, prints every check as a PASS / FAIL / INFO table, and tells the caller whether to go on.
// The report holds only booleans, fixed words and table names, so the table can be pasted anywhere.

const word = (ok) => (ok ? "PASS" : "FAIL");

/** The rows of the table, from the parsed report. INFO rows are facts that do not decide readiness. */
export function readinessRows(report) {
  const { config = {}, database, schema, appRole, data } = report.checks ?? {};
  const rows = [
    ["config.otpPepper", word(config.otpPepper === true), "OTP_PEPPER is set, 32 or more characters, not the placeholder"],
    ["config.webhookSecret", word(config.webhookSecret === true), "PAYMENT_WEBHOOK_SECRET is set, 32 or more characters, not the placeholder"],
    ["config.demoMode", "INFO", String(config.demoMode)],
    ["config.opsTestEnabled", "INFO", `${config.opsTestEnabled} (true when OPS_TEST_TOKEN is set; the error-test route exists)`],
    ["config.vercelSystemVars", "INFO", `${config.vercelSystemVars} (true on Vercel with system variables exposed)`],
    ["config.nodeMajor", "INFO", String(config.nodeMajor)],
    ["database", word(database === "ok"), String(database)],
  ];
  const skipped = (value) => value === "skipped" || value === undefined;
  rows.push(["schema", skipped(schema) ? "FAIL" : word(schema.missingTables?.length === 0), skipped(schema) ? "skipped" : schema.missingTables?.length === 0 ? "no table or column missing" : `missing: ${schema.missingTables.join(", ")}`]);
  if (skipped(appRole)) rows.push(["appRole", "FAIL", "skipped"]);
  else {
    rows.push(["appRole.isSuperuser", word(appRole.isSuperuser === false), `${appRole.isSuperuser} (must be false)`]);
    rows.push(["appRole.canInsertOtp", word(appRole.canInsertOtp === true), `${appRole.canInsertOtp} (must be true)`]);
    rows.push(["appRole.canUpdateLedger", word(appRole.canUpdateLedger === false), `${appRole.canUpdateLedger} (must be false)`]);
    rows.push(["appRole.canDeleteAuditLog", word(appRole.canDeleteAuditLog === false), `${appRole.canDeleteAuditLog} (must be false)`]);
    rows.push(["appRole.canInsertErrorEvents", word(appRole.canInsertErrorEvents === true), `${appRole.canInsertErrorEvents} (must be true)`]);
    rows.push(["appRole.canReadErrorEvents", word(appRole.canReadErrorEvents === false), `${appRole.canReadErrorEvents} (must be false)`]);
  }
  rows.push(["data.seeded", skipped(data) ? "FAIL" : word(data.seeded === true), skipped(data) ? "skipped" : String(data.seeded)]);
  return rows;
}

/**
 * The only checks `--allow-owner-role` may let pass: what an OWNER connection fails (it is a superuser or at least the table owner, so it can update the
 * ledger, delete from the audit log and read the error log). LOCAL DEVELOPMENT ONLY (D136): a developer's database has no app role.
 */
export const OWNER_ROLE_CHECKS = ["appRole.isSuperuser", "appRole.canUpdateLedger", "appRole.canDeleteAuditLog", "appRole.canReadErrorEvents"];

/** Is this base URL on this machine? Exactly localhost or 127.0.0.1: a host that merely starts with one of them is not. */
export function isLocalBaseUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Prints the readiness table and returns true when the deployment is ready. When it is not, it prints a plain message naming
 * the failing checks and returns false, and the caller stops before it tries to log in.
 */
export async function readinessFirst(baseUrl, label, { allowOwnerRole = false } = {}) {
  if (allowOwnerRole && !isLocalBaseUrl(baseUrl)) {
    console.log(`${label}: REFUSED --allow-owner-role: it is for local development only, and ${baseUrl} is not localhost or 127.0.0.1. No request was sent.`);
    return false;
  }
  let report = null;
  let status = 0;
  try {
    const response = await fetch(`${baseUrl}/api/health/ready`, { redirect: "manual" });
    status = response.status;
    report = await response.json().catch(() => null);
  } catch {
    status = 0;
  }
  console.log(`${label}: readiness of ${baseUrl}`);
  if (report === null || typeof report !== "object" || !report.checks) {
    console.log(`FAIL  readiness endpoint  GET /api/health/ready answered ${status === 0 ? "nothing" : `HTTP ${status}`} and no report`);
    console.log("\nStopped before login: the server did not give a readiness report. Is it running, and is it a build that has /api/health/ready?");
    return false;
  }
  const rows = readinessRows(report);
  const width = Math.max(...rows.map((row) => row[0].length));
  for (const [name, result, detail] of rows) console.log(`${result.padEnd(4)}  ${name.padEnd(width)}  ${detail}`);
  const failing = rows.filter((row) => row[1] === "FAIL").map((row) => row[0]);
  if (failing.length === 0 && report.status === "ok") {
    console.log("\nREADY: the deployment can sign someone in. Starting the checks.\n");
    return true;
  }
  if (allowOwnerRole && failing.length > 0 && failing.every((name) => OWNER_ROLE_CHECKS.includes(name))) {
    console.log("\n!!! WARNING: --allow-owner-role is set. The only failures are the ones an OWNER connection has (" + failing.join(", ") + ").");
    console.log("!!! This server connects as the database owner, not as the restricted app role. That is acceptable on a developer's machine ONLY.");
    console.log("!!! Never use this flag against a deployment. Continuing with the checks.\n");
    return true;
  }
  console.log(`\nStopped before login: not ready (HTTP ${status}). Failing: ${failing.join(", ") || "status is degraded"}. See docs/deploy-checklist.md, "If the readiness check fails".`);
  return false;
}
