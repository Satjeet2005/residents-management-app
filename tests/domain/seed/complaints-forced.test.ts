import { describe, expect, it } from "vitest";
import { dataset, complaintsOf, flatOf, ist, userNamed } from "./complaint-helpers";

const eventsOf = (key: string) => dataset.events.filter((e) => e.complaintKey === key);

describe("C7 forced facts", () => {
  it("C7 T12-0408: Swati Joshi's PLUMBING 'Water leak' is ASSIGNED to Kavita Rao, due 2026-10-27 17:00 IST", () => {
    const [leak, ...rest] = complaintsOf("T12-0408");
    expect(rest).toHaveLength(0);
    expect(leak).toMatchObject({
      raisedByUserKey: userNamed("Swati Joshi").key,
      categoryCode: "PLUMBING",
      urgency: "NORMAL",
      status: "ASSIGNED",
      assigneeUserKey: userNamed("Kavita Rao").key,
      createdAt: ist("2026-10-26", 17),
      responseDueAt: ist("2026-10-27", 17),
      firstResponseAt: null,
      safetyFlag: false,
    });
    expect(leak.body).toContain("Water leak");
    const assigned = eventsOf(leak.key).find((e) => e.type === "ASSIGNED");
    expect(assigned?.createdAt).toBe(ist("2026-10-26", 17, 30));
  });

  it("C7 T07-1203: Neeraj Kulkarni's ELECTRICAL 'Corridor light not working' is PENDING_CONFIRMATION since 2026-10-26 15:00 IST", () => {
    const [light, ...rest] = complaintsOf("T07-1203");
    expect(rest).toHaveLength(0);
    expect(light).toMatchObject({
      raisedByUserKey: userNamed("Neeraj Kulkarni").key,
      body: "Corridor light not working",
      categoryCode: "ELECTRICAL",
      status: "PENDING_CONFIRMATION",
      pendingConfirmationAt: ist("2026-10-26", 15),
      closedAt: null,
    });
  });

  it("C7 T15-0902: Rohit Deshmukh's HOUSEKEEPING complaint is NEW, raised 2026-10-27 10:00 IST, with no assignee", () => {
    const [garbage, ...rest] = complaintsOf("T15-0902");
    expect(rest).toHaveLength(0);
    expect(garbage).toMatchObject({
      raisedByUserKey: userNamed("Rohit Deshmukh").key,
      categoryCode: "HOUSEKEEPING",
      status: "NEW",
      assigneeUserKey: null,
      createdAt: ist("2026-10-27", 10),
    });
  });

  it("C7 the gas smell in tower T09 is ESCALATED at 11:01 and ASSIGNED to Sanjay Pawar, with no staff acknowledgement", () => {
    const gas = dataset.complaints.find((c) => c.body === "Smell of gas in the corridor")!;
    expect(gas.flatKey.startsWith("flat:T09-")).toBe(true);
    expect(gas).toMatchObject({
      safetyFlag: true,
      urgency: "CRITICAL",
      status: "ASSIGNED",
      assigneeUserKey: userNamed("Sanjay Pawar").key,
      createdAt: ist("2026-10-27", 11),
      firstResponseAt: null,
      closedAt: null,
    });
    const events = eventsOf(gas.key);
    expect(events.find((e) => e.type === "ESCALATED")?.createdAt).toBe(ist("2026-10-27", 11, 1));
    expect(events.some((e) => e.type === "STATUS_CHANGED" || e.type === "COMMENT")).toBe(false);
  });

  it("C7 T21-1601 has no complaints", () => {
    expect(complaintsOf("T21-1601")).toHaveLength(0);
    expect(dataset.affected.filter((a) => a.flatKey === flatOf("T21-1601").key)).toHaveLength(0);
  });

  it("C7 Swati Joshi has exactly 2 unread notifications: COMPLAINT_ASSIGNED and PAYMENT_REMINDER", () => {
    const mine = dataset.notifications.filter((n) => n.userKey === userNamed("Swati Joshi").key);
    expect(mine.filter((n) => n.readAt === null).map((n) => n.kind).sort()).toEqual(["COMPLAINT_ASSIGNED", "PAYMENT_REMINDER"]);
    expect(mine).toHaveLength(2);
  });

  it("C7 T12-0408 has two visitors expected today: Ramesh Gupta at 11:00 and Anita Singh at 16:30 IST", () => {
    const passes = dataset.visitorPasses.filter((p) => p.flatKey === flatOf("T12-0408").key);
    expect(passes.map((p) => [p.visitorName, p.expectedAt, p.status])).toEqual([
      ["Ramesh Gupta", ist("2026-10-27", 11), "EXPECTED"],
      ["Anita Singh", ist("2026-10-27", 16, 30), "EXPECTED"],
    ]);
  });

  it("C7 no random complaint uses the four sample flats", () => {
    for (const code of ["T12-0408", "T07-1203", "T15-0902", "T21-1601"]) {
      for (const c of complaintsOf(code)) expect(c.key, code).toContain("forced-");
    }
  });
});
