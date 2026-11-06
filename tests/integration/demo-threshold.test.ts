import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPROVAL_THRESHOLD_PAISE } from "@/domain/seed/settings";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/** D116: the hosted database is updated by hand with the statement in docs/deploy-checklist.md; this runs that exact text on a freshly seeded database. */
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
const update = checklist.find((b) => /UPDATE society_settings/.test(b)) as string;
const verify = checklist.find((b) => /^SELECT key, value FROM society_settings/m.test(b)) as string;

describe("D116 the demo threshold", () => {
  it("is ₹10,000 in the seed, and a freshly seeded database holds it", async () => {
    expect(APPROVAL_THRESHOLD_PAISE).toBe(1_000_000);
    const row = await owner.query("SELECT value FROM society_settings WHERE key = 'approval_threshold_paise'");
    expect(row.rows[0].value).toBe(1_000_000);
  });

  it("the documented UPDATE changes one row from the old ₹25,000 to ₹10,000, and the documented SELECT shows it", async () => {
    await owner.query("UPDATE society_settings SET value = '2500000'::jsonb WHERE key = 'approval_threshold_paise'");
    expect(update).toBeDefined();
    const result = await owner.query(update);
    expect(result.rowCount).toBe(1);
    const shown = await owner.query(verify);
    expect(shown.rows).toEqual([{ key: "approval_threshold_paise", value: 1_000_000 }]);
  });

  it("the same statement is in the deployment plan", () => {
    expect(sqlBlocks("docs/deployment-plan.md").join("\n")).toContain("UPDATE society_settings SET value = '1000000'::jsonb WHERE key = 'approval_threshold_paise';");
  });

  it("the app role still cannot update society_settings, so only the owner can", async () => {
    const app = await fx.role.open();
    try {
      await expect(app.query("UPDATE society_settings SET value = '1'::jsonb WHERE key = 'approval_threshold_paise'")).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
    const row = await owner.query("SELECT value FROM society_settings WHERE key = 'approval_threshold_paise'");
    expect(row.rows[0].value).toBe(1_000_000);
  });
});
