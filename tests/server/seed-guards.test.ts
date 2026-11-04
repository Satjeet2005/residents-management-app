import { describe, expect, it } from "vitest";
import { assertSafeTarget, checkConfirmed, checkDemoMode, checkEmpty, describeTarget, parseTarget } from "@/server/seed/guards";

describe("G1 seed guards", () => {
  it("G1 DEMO_MODE must be exactly the text true", () => {
    expect(checkDemoMode("true").ok).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) expect(checkDemoMode(value).ok, String(value)).toBe(false);
  });

  it("G1 the database must have no flats, and the refusal points at db:reset-demo", () => {
    expect(checkEmpty(0).ok).toBe(true);
    const refused = checkEmpty(2400);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toContain("not empty");
      expect(refused.reason).toContain("npm run db:reset-demo");
    }
  });

  it("G1 --yes must be present as its own argument", () => {
    expect(checkConfirmed(["--yes"]).ok).toBe(true);
    expect(checkConfirmed(["--reset", "--yes"]).ok).toBe(true);
    for (const args of [[], ["--reset"], ["yes"], ["--yes-please"], ["-y"]]) expect(checkConfirmed(args).ok, args.join(" ")).toBe(false);
  });

  it("G1 the printed target is the host and database name only, never the user, password or URL", () => {
    const text = describeTarget("postgresql://someuser:s3cretpass@db.example.test:5436/township?sslmode=require");
    expect(text).toBe("host db.example.test:5436, database township");
    expect(text).not.toMatch(/someuser|s3cretpass|postgresql|sslmode/);
  });
});

const reset = (host: string, database: string, ...more: string[]) => assertSafeTarget({ host, database, flags: ["--reset", "--yes", ...more] });
const seed = (host: string, database: string, ...more: string[]) => assertSafeTarget({ host, database, flags: ["--yes", ...more] });

describe("G2 reset targets", () => {
  it.each(["localhost", "127.0.0.1", "::1"])("G2 a reset on %s with a matching confirmation is allowed", (host) => {
    expect(reset(host, "township_seed_scratch", "--confirm-database=township_seed_scratch").ok).toBe(true);
  });

  it.each([
    "localhost.evil.com",
    "127.0.0.1.nip.io",
    "evil-localhost",
    "xlocalhost",
    "localhost.",
    "127.0.0.2",
    "0.0.0.0",
    "::2",
    "db.example.test",
    "ep-cool-name.neon.tech",
    "",
  ])("G2 a reset on the look-alike or remote host %j is refused, even with the right confirmation", (host) => {
    const result = reset(host, "township_seed_scratch", "--confirm-database=township_seed_scratch", "--allow-remote");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("only allowed on localhost");
  });

  it.each(["township", "township_seed_scratch", "township_test_1a2b3c4d", "township_test_x"])("G2 the database %s may be reset", (database) => {
    expect(reset("localhost", database, `--confirm-database=${database}`).ok).toBe(true);
  });

  it.each([
    "township_prod",
    "township_test",
    "TOWNSHIP_TEST_1",
    "Township",
    "township_seed_scratch2",
    "xtownship_test_1",
    "township_seed",
    "postgres",
    "template1",
    "",
  ])("G2 the database %j is refused for a reset, even when it is typed as the confirmation", (database) => {
    const result = reset("localhost", database, `--confirm-database=${database}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("only allowed on township");
  });

  it("G2 --yes alone is not enough for a reset: the confirmation must be present and exact", () => {
    for (const confirmation of [[], ["--confirm-database="], ["--confirm-database=township_seed_scratc"], ["--confirm-database=township_seed_scratch "], ["--confirm-database=TOWNSHIP_SEED_SCRATCH"], ["--confirm-database=township"], ["--confirm-database", "township_seed_scratch"]]) {
      const result = reset("localhost", "township_seed_scratch", ...confirmation);
      expect(result.ok, confirmation.join(" ")).toBe(false);
      if (!result.ok) expect(result.reason).toContain("--confirm-database=township_seed_scratch");
    }
  });

  it("G2 two --confirm-database flags are refused, even if one is right", () => {
    expect(reset("localhost", "township", "--confirm-database=township", "--confirm-database=township").ok).toBe(false);
    expect(reset("localhost", "township", "--confirm-database=other", "--confirm-database=township").ok).toBe(false);
  });
});

describe("G3 seed targets", () => {
  it("G3 a seed on a local host needs neither --allow-remote nor a confirmation", () => {
    for (const host of ["localhost", "127.0.0.1", "::1"]) expect(seed(host, "anything_local").ok, host).toBe(true);
  });

  it("G3 a seed on a remote host is refused without --allow-remote", () => {
    const result = seed("db.example.test", "township", "--confirm-database=township");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("--allow-remote");
  });

  it("G3 a seed on a remote host is refused without the exact confirmation", () => {
    for (const confirmation of [[], ["--confirm-database=other"], ["--confirm-database="], ["--confirm-database=Township"]]) {
      expect(seed("db.example.test", "township", "--allow-remote", ...confirmation).ok, confirmation.join(" ")).toBe(false);
    }
  });

  it("G3 a seed on a remote host is allowed with both --allow-remote and the exact confirmation", () => {
    expect(seed("db.example.test", "demo_db", "--allow-remote", "--confirm-database=demo_db").ok).toBe(true);
    expect(seed("localhost.evil.com", "demo_db", "--allow-remote", "--confirm-database=demo_db").ok).toBe(true);
  });

  it("G3 --allow-remote does not turn a remote reset into a seed: it is still refused", () => {
    expect(reset("db.example.test", "township", "--allow-remote", "--confirm-database=township").ok).toBe(false);
  });

  it("G3 refusals never contain a user, password or URL", () => {
    const { host, database } = parseTarget("postgresql://someuser:s3cretpass@db.example.test:5432/township?sslmode=require");
    expect([host, database]).toEqual(["db.example.test", "township"]);
    for (const flags of [["--reset", "--yes"], ["--yes"], ["--yes", "--allow-remote"]]) {
      const result = assertSafeTarget({ host, database, flags });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).not.toMatch(/someuser|s3cretpass|postgresql|sslmode/);
    }
  });

  it("G3 parseTarget drops the port and brackets and lower-cases the host", () => {
    expect(parseTarget("postgresql://u:p@[::1]:5436/township")).toEqual({ host: "::1", database: "township" });
    expect(parseTarget("postgresql://u:p@LocalHost:5436/township_test_ab")).toEqual({ host: "localhost", database: "township_test_ab" });
  });
});
