import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roleTitleKey } from "@/domain/auth/role-title";
import { roleTitle } from "@/lib/staff-home";

/** The five seeded staff accounts, read from the seed source so the table cannot drift from the data. */
const seeded = [...readFileSync("src/domain/seed/people.ts", "utf8").matchAll(/\{ name: "([^"]+)", permissions: \[([^\]]*)\] \}/g)].map((m) => ({
  name: m[1],
  permissions: [...m[2].matchAll(/"([^"]+)"/g)].map((p) => p[1]),
}));

const EXPECTED: Record<string, string> = {
  "Priya Nair": "Accountant",
  "Rahul Menon": "Accountant and approver",
  "Meera Kapoor": "Committee",
  "Kavita Rao": "Complaints manager",
  "Sanjay Pawar": "Duty manager",
};

describe("RT1 roleTitle comes from permissions (D186)", () => {
  it("reads all five seeded staff accounts", () => {
    expect(seeded.map((s) => s.name)).toEqual(Object.keys(EXPECTED));
  });

  it.each(Object.entries(EXPECTED))("%s is %s", (name, title) => {
    expect(roleTitle(seeded.find((s) => s.name === name)?.permissions ?? [])).toBe(title);
  });

  it.each([
    [["complaints:duty_manager", "complaints:manage", "payments:match", "payments:approve", "reports:view"], "Duty manager"],
    [["complaints:manage", "payments:match", "payments:approve"], "Complaints manager"],
    [["payments:approve", "payments:match"], "Accountant and approver"],
    [["payments:approve", "reports:view"], "Approver"],
    [["payments:match", "reports:view"], "Accountant"],
    [["reports:view"], "Committee"],
    [["complaints:duty_manager"], "Duty manager"],
  ])("%j is %s (first match wins)", (permissions, title) => {
    expect(roleTitle(permissions)).toBe(title);
  });

  it.each([[[]], [["admin"]], [["payments"]], [["__proto__", "constructor"]], [["PAYMENTS:MATCH"]], [[""]], [["payments:match "]]])("%j is plain Staff", (permissions) => {
    expect(roleTitle(permissions)).toBe("Staff");
    expect(roleTitleKey(permissions)).toBe("STAFF");
  });

  it("does not depend on the order of the list", () => {
    expect(roleTitle(["payments:approve", "payments:match"])).toBe(roleTitle(["payments:match", "payments:approve"]));
  });
});
