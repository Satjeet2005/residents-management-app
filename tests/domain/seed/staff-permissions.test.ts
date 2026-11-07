import { describe, expect, it } from "vitest";
import { defaultDataset } from "./default-dataset";

/** The permissions of every seeded staff user, by name. */
const staff = () => {
  const dataset = defaultDataset();
  const names = new Map(dataset.users.map((u) => [u.key, u.name]));
  return dataset.staff.map((s) => ({ name: names.get(s.userKey) ?? "", permissions: s.permissions }));
};

describe("S8 the seed's staff permissions (R66)", () => {
  it("every staff user who holds complaints:duty_manager also holds complaints:manage, because the staff complaint pages need complaints:manage", () => {
    const duty = staff().filter((s) => s.permissions.includes("complaints:duty_manager"));
    expect(duty.map((s) => s.name)).toEqual(["Sanjay Pawar"]);
    for (const s of duty) expect(s.permissions, s.name).toContain("complaints:manage");
  });

  it("exactly one staff user holds reports:view: Meera Kapoor, who opens the committee report", () => {
    expect(staff().filter((s) => s.permissions.includes("reports:view")).map((s) => s.name)).toEqual(["Meera Kapoor"]);
  });
});
