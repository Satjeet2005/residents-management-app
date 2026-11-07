import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMMITTEE_GOALS } from "@/domain/seed/settings";
import { goalsFromSetting } from "@/domain/reports/goals";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/** R67: the hosted database gets the committee's goals by hand with the statement in docs/deploy-checklist.md; this runs that exact text on a freshly seeded database. */
let fx: PaymentsFixture;
let owner: Client;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  owner = new Client({ connectionString: fx.scratchUrl });
  await owner.connect();
}, 120_000);
afterAll(async () => {
  await owner?.end();
  await fx?.close();
}, 60_000);

const sqlBlocks = (file: string): string[] => [...readFileSync(file, "utf8").matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const checklist = sqlBlocks("docs/deploy-checklist.md");
const insert = checklist.find((b) => /INSERT INTO society_settings/.test(b)) as string;
const verify = checklist.find((b) => /^SELECT key, value FROM society_settings WHERE key = 'committee_goals'/m.test(b)) as string;
const GOALS = { onTimeCollectionPercent: 90, firstReplyWithinSlaPercent: 90, reopenedPercentMax: 8 };

describe("R67 the committee goals setting", () => {
  it("is in the seed, with the three assumed targets, and a freshly seeded database holds it", async () => {
    expect(COMMITTEE_GOALS).toEqual(GOALS);
    const row = await owner.query("SELECT value FROM society_settings WHERE key = 'committee_goals'");
    expect(row.rows[0].value).toEqual(GOALS);
    expect(goalsFromSetting(row.rows[0].value)).toEqual({ goals: GOALS, source: "SETTING" });
  });

  it("the documented INSERT adds the row to a database that lacks it, and the documented SELECT shows it", async () => {
    await owner.query("DELETE FROM society_settings WHERE key = 'committee_goals'");
    expect(insert).toBeDefined();
    expect(verify).toBeDefined();
    const result = await owner.query(insert);
    expect(result.rowCount).toBe(1);
    const shown = await owner.query(verify);
    expect(shown.rows).toEqual([{ key: "committee_goals", value: GOALS }]);
  });

  it("running it again changes nothing (INSERT 0 0), so it is safe to run twice", async () => {
    const again = await owner.query(insert);
    expect(again.rowCount).toBe(0);
    expect((await owner.query(verify)).rows).toEqual([{ key: "committee_goals", value: GOALS }]);
  });

  it("the same statement and check are in the deployment plan", () => {
    const plan = sqlBlocks("docs/deployment-plan.md").join("\n");
    expect(plan).toContain(insert.split("\n").find((l) => l.startsWith("INSERT")) as string);
    expect(plan).toContain("SELECT key, value FROM society_settings WHERE key = 'committee_goals';");
  });

  it("the app role cannot write a setting, so only the owner can", async () => {
    const app = await fx.role.open();
    try {
      await expect(app.query("INSERT INTO society_settings (key, value) VALUES ('committee_goals_x', '1'::jsonb)")).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});
