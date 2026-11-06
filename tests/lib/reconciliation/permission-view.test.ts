import { describe, expect, it } from "vitest";
import { approvalView, type Viewer } from "@/lib/reconciliation/permission-view";

const viewer = (over: Partial<Viewer> = {}): Viewer => ({ id: "rahul", role: "STAFF", active: true, permissions: ["payments:match", "payments:approve"], ...over });

describe("RP1 who sees Approve and Reject", () => {
  it("another person with payments:approve sees the actions", () => {
    expect(approvalView(viewer(), "priya")).toBe("ACTIONS");
  });

  it("the requester never does, even with payments:approve (nobody approves their own request)", () => {
    expect(approvalView(viewer({ id: "priya" }), "priya")).toBe("WAITING");
  });

  it("a person with payments:match only waits", () => {
    expect(approvalView(viewer({ permissions: ["payments:match"] }), "priya")).toBe("WAITING");
  });

  it("an inactive person, and a resident, wait", () => {
    expect(approvalView(viewer({ active: false }), "priya")).toBe("WAITING");
    expect(approvalView(viewer({ role: "RESIDENT" }), "priya")).toBe("WAITING");
  });
});
