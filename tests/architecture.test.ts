import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const SAMPLE_PATH = "src/domain/sample.ts";

async function lint(source: string) {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(source, { filePath: SAMPLE_PATH });
  return result.messages;
}

describe("domain boundary", () => {
  it("reports an error when src/domain imports @prisma/client", async () => {
    const messages = await lint(
      'import { PrismaClient } from "@prisma/client";\nexport const db = PrismaClient;\n',
    );
    const rule = messages.find((m) => m.ruleId === "no-restricted-imports");
    expect(rule?.severity).toBe(2);
  });

  it.each(["next/server", "react", "@/server/db", "@/app/page"])(
    "reports an error when src/domain imports %s",
    async (specifier) => {
      const messages = await lint(`import x from "${specifier}";\nexport default x;\n`);
      expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
    },
  );

  it("accepts pure TypeScript in src/domain", async () => {
    const messages = await lint("export const add = (a: number, b: number) => a + b;\n");
    expect(messages).toEqual([]);
  });
});
