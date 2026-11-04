import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("integration test setup", () => {
  it("fails with a clear message when DATABASE_URL is not set", () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.mts"],
      // An empty value counts as set for Node's .env loading, so a local .env cannot supply one.
      { env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8", timeout: 60_000 },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("DATABASE_URL is not set");
    expect(result.stderr + result.stdout).not.toContain("charCodeAt");
  }, 90_000);
});
