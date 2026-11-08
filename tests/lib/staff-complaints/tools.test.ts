import { describe, expect, it } from "vitest";
import { staffToolsFor } from "@/lib/staff-tools";

const staff = (permissions: string[], active = true) => ({ role: "STAFF" as const, active, permissions });

describe("SC15 the Complaints tool", () => {
  it("is offered to complaints:manage and to nobody else", () => {
    expect(staffToolsFor(staff(["complaints:manage"])).map((tool) => tool.href)).toEqual(["/staff/complaints"]);
    expect(staffToolsFor(staff(["complaints:duty_manager"]))).toEqual([]);
    expect(staffToolsFor(staff(["payments:match", "payments:approve"])).map((tool) => tool.key)).toEqual(["reconciliation"]);
    expect(staffToolsFor(staff(["complaints:manage"], false))).toEqual([]);
    expect(staffToolsFor({ role: "RESIDENT", active: true, permissions: ["complaints:manage"] })).toEqual([]);
  });

  it("comes before Bank statement matching for a person who holds both", () => {
    expect(staffToolsFor(staff(["complaints:manage", "payments:match"])).map((tool) => tool.key)).toEqual(["complaints", "reconciliation"]);
  });
});
