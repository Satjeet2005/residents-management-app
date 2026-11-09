import { beforeEach, describe, expect, it, vi } from "vitest";

const redirected: string[] = [];
let permissions: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.push(to);
    throw new Error("NEXT_REDIRECT");
  },
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
  usePathname: () => "/staff",
}));
vi.mock("@/server/auth/current-user", () => ({ requireUser: async () => ({ id: "u1", name: "Test Person", role: "STAFF", active: true, permissions }) }));
vi.mock("@/server/auth/default-deps", () => ({ defaultDeps: () => ({ db: {} }) }));
vi.mock("@/server/clock", () => ({ businessNow: () => 1_800_000_000_000 }));
vi.mock("@/server/staff/home-data", () => ({ loadStaffHome: async () => ({ complaints: null, unseenSafety: null, statements: null, approvals: null, paymentRows: null, complaintRows: null }) }));

import StaffPage from "@/app/(staff)/staff/page";

beforeEach(() => {
  redirected.length = 0;
});

describe("SH9 the staff home page sends a committee-only person to the report (D236)", () => {
  it("a person whose only tool is the report is redirected to /staff/reports", async () => {
    permissions = ["reports:view"];
    await expect(StaffPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected).toEqual(["/staff/reports"]);
  });

  it("a person with the report AND another tool is not redirected and sees the staff home", async () => {
    permissions = ["reports:view", "payments:match"];
    const element = await StaffPage();
    expect(redirected).toEqual([]);
    expect(element).toBeTruthy();
  });

  it("an accountant is not redirected", async () => {
    permissions = ["payments:match"];
    await StaffPage();
    expect(redirected).toEqual([]);
  });
});
