import { describe, expect, it } from "vitest";
import { checkPrune, parsePruneArgs } from "@/server/error-prune";

/** D135: the arguments and guards of `npm run db:prune-errors`, which are the seed command's guards plus a mandatory confirmation. */

const LOCAL = "postgresql://owner:pw@localhost:5436/township";
const REMOTE = "postgresql://owner:SuperSecretPw@ep-quiet-lake-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

describe("D135 parsePruneArgs", () => {
  it("defaults to 30 days", () => {
    expect(parsePruneArgs(["--yes"])).toEqual({ ok: true, days: 30, flags: ["--yes"] });
  });

  it.each([["1", 1], ["30", 30], ["365", 365]])("accepts --days=%s", (text, days) => {
    expect(parsePruneArgs([`--days=${text}`])).toMatchObject({ ok: true, days });
  });

  it.each(["0", "366", "-5", "1.5", "abc", "", "30d", "99999"])("refuses --days=%j", (text) => {
    expect(parsePruneArgs([`--days=${text}`]).ok).toBe(false);
  });

  it.each([["--force"], ["--days=3", "--days=4"], ["--yes", "--yes"], ["--confirm-database=a", "--confirm-database=b"], ["days=3"]])("refuses %j", (...args) => {
    expect(parsePruneArgs(args).ok).toBe(false);
  });
});

describe("D135 checkPrune", () => {
  const ok = (url: string, flags: string[]) => checkPrune(url, flags);

  it("refuses without DATABASE_URL and with one that is not a URL", () => {
    expect(checkPrune(undefined, ["--yes"]).ok).toBe(false);
    expect(checkPrune("not a url", ["--yes"]).ok).toBe(false);
  });

  it("refuses without --yes, and without the exact --confirm-database, even on localhost", () => {
    expect(ok(LOCAL, ["--confirm-database=township"]).ok).toBe(false);
    expect(ok(LOCAL, ["--yes"]).ok).toBe(false);
    expect(ok(LOCAL, ["--yes", "--confirm-database=other"]).ok).toBe(false);
    expect(ok(LOCAL, ["--yes", "--confirm-database=township"])).toEqual({ ok: true });
  });

  it("refuses a hosted database without --allow-remote, and with it only when the name is confirmed", () => {
    const base = ["--yes", "--confirm-database=neondb"];
    expect(ok(REMOTE, base).ok).toBe(false);
    expect(ok(REMOTE, [...base, "--allow-remote"])).toEqual({ ok: true });
    expect(ok(REMOTE, ["--yes", "--allow-remote", "--confirm-database=township"]).ok).toBe(false);
  });

  it("no refusal contains the user, the password or the URL", () => {
    const reasons = [checkPrune(REMOTE, ["--yes"]), checkPrune(REMOTE, ["--yes", "--confirm-database=neondb"]), checkPrune(REMOTE, [])].map((r) => (r.ok ? "" : r.reason));
    for (const reason of reasons) expect(reason).not.toMatch(/SuperSecretPw|owner|postgresql:\/\/|sslmode/);
  });
});
