import { Client } from "pg";
import { describe, expect, it } from "vitest";

describe("database connection", () => {
  it("runs SELECT 1", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query("SELECT 1 AS one");
      expect(result.rows[0].one).toBe(1);
    } finally {
      await client.end();
    }
  });
});
