import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, isPermission, type Permission } from "@/domain/auth/permissions";

describe("AU6 PERMISSIONS and isPermission", () => {
  it("lists the five permissions", () => {
    expect([...PERMISSIONS]).toEqual(["payments:match", "payments:approve", "reports:view", "complaints:manage", "complaints:duty_manager"]);
  });

  it.each(PERMISSIONS)("%s is a permission", (permission) => {
    expect(isPermission(permission)).toBe(true);
  });

  it.each([["" ], ["payments"], ["payments:Match"], [" payments:match"], ["payments:match "], ["admin"], ["*"], [null], [undefined], [5], [{}], [["payments:match"]]])("%j is not a permission", (value) => {
    expect(isPermission(value)).toBe(false);
  });
});

describe("AU6 can", () => {
  const all: string[] = [...PERMISSIONS];

  it.each(PERMISSIONS)("a resident holding every permission string still cannot %s", (needed) => {
    expect(can({ role: "RESIDENT", active: true, permissions: all }, needed)).toBe(false);
  });

  it.each(PERMISSIONS)("an inactive staff member with every permission cannot %s", (needed) => {
    expect(can({ role: "STAFF", active: false, permissions: all }, needed)).toBe(false);
  });

  it.each(PERMISSIONS)("an active staff member with %s can", (needed) => {
    expect(can({ role: "STAFF", active: true, permissions: [needed] }, needed)).toBe(true);
  });

  it("an active staff member without the permission cannot, whatever else is held", () => {
    expect(can({ role: "STAFF", active: true, permissions: ["reports:view"] }, "payments:approve")).toBe(false);
    expect(can({ role: "STAFF", active: true, permissions: [] }, "payments:match")).toBe(false);
    expect(can({ role: "STAFF", active: true, permissions: ["payments:match"] }, "payments:approve")).toBe(false);
  });

  it.each(["", "payments", "admin", "*", "PAYMENTS:MATCH", "payments:match ", "payments:matc"])("the string %j does not give a permission", (held) => {
    for (const needed of PERMISSIONS as readonly Permission[]) {
      expect(can({ role: "STAFF", active: true, permissions: [held] }, needed)).toBe(false);
    }
  });

  it("matching permissions are independent: match does not give approve", () => {
    expect(can({ role: "STAFF", active: true, permissions: ["payments:match"] }, "payments:match")).toBe(true);
    expect(can({ role: "STAFF", active: true, permissions: ["payments:match"] }, "payments:approve")).toBe(false);
  });
});
