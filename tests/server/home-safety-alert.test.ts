import { describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { assembleHome, safetyAlertOf, safetyTimeoutMinutes, type ComplaintRow, type SettingsRow } from "@/server/home/mapper";
import { inputFor } from "./home-fixtures";

const MIN = 60_000;
const settings = (extra: SettingsRow[] = []): SettingsRow[] => [{ key: "duty_manager_phone", value: "5900000001" }, { key: "emergency_services_phone", value: null }, ...extra];
const row = (over: Partial<ComplaintRow>): ComplaintRow => ({ id: "c1", safetyFlag: true, body: "Gas smell in the corridor", status: "ASSIGNED", createdAt: new Date(DEMO_NOW), responseDueAt: null, firstResponseAt: null, acknowledgedAt: null, ...over });

describe("D126 safetyAlertOf", () => {
  it("is null with no open safety complaint: none at all, an ordinary one, or a closed safety one", () => {
    expect(safetyAlertOf([], settings(), DEMO_NOW)).toBeNull();
    expect(safetyAlertOf([row({ safetyFlag: false })], settings(), DEMO_NOW)).toBeNull();
    expect(safetyAlertOf([row({ status: "CLOSED" })], settings(), DEMO_NOW)).toBeNull();
  });

  it("1a: sent, the category from the safety word, the duty manager's number, not seen", () => {
    expect(safetyAlertOf([row({})], settings(), DEMO_NOW + MIN)).toEqual({ state: "SENT", category: "GAS", seenAt: null, callPhone: "5900000001" });
  });

  it("1b: seen once the duty manager has acknowledged, with the time of the acknowledgement", () => {
    const seenAt = DEMO_NOW + 2 * MIN;
    expect(safetyAlertOf([row({ acknowledgedAt: new Date(seenAt) })], settings(), DEMO_NOW + 3 * MIN)).toEqual({ state: "SEEN", category: "GAS", seenAt, callPhone: "5900000001" });
  });

  it("D149 a first reply by other staff (first_response_at) is not an acknowledgement: 1a, then 1c", () => {
    const replied = row({ firstResponseAt: new Date(DEMO_NOW + MIN) });
    expect(safetyAlertOf([replied], settings(), DEMO_NOW + 2 * MIN)).toMatchObject({ state: "SENT", seenAt: null });
    expect(safetyAlertOf([replied], settings(), DEMO_NOW + 5 * MIN)).toMatchObject({ state: "NO_ANSWER", seenAt: null });
  });

  it("1b is NOT shown before the acknowledgement, whatever else has happened to the complaint", () => {
    for (const status of ["NEW", "ASSIGNED", "IN_PROGRESS", "REOPENED"] as const) expect(safetyAlertOf([row({ status })], settings(), DEMO_NOW + MIN)?.state, status).toBe("SENT");
  });

  it("1c: no answer after the timeout; the number is emergency services when set, else the duty manager's", () => {
    expect(safetyAlertOf([row({})], settings(), DEMO_NOW + 5 * MIN)).toMatchObject({ state: "NO_ANSWER", callPhone: "5900000001" });
    const withServices: SettingsRow[] = [{ key: "duty_manager_phone", value: "5900000001" }, { key: "emergency_services_phone", value: "112" }];
    expect(safetyAlertOf([row({})], withServices, DEMO_NOW + 5 * MIN)).toMatchObject({ state: "NO_ANSWER", callPhone: "112" });
    expect(safetyAlertOf([row({})], withServices, DEMO_NOW + MIN)).toMatchObject({ state: "SENT", callPhone: "5900000001" });
  });

  it("the timeout is the safety_ack_timeout_minutes setting: 10 minutes keeps SENT at minute 6; a bad value falls back to 5", () => {
    const ten = settings([{ key: "safety_ack_timeout_minutes", value: 10 }]);
    expect(safetyAlertOf([row({})], ten, DEMO_NOW + 6 * MIN)?.state).toBe("SENT");
    expect(safetyAlertOf([row({})], ten, DEMO_NOW + 10 * MIN)?.state).toBe("NO_ANSWER");
    for (const bad of [0, -3, 2.5, "5", null, 100_000]) expect(safetyTimeoutMinutes([{ key: "safety_ack_timeout_minutes", value: bad }]), String(bad)).toBe(5);
    expect(safetyTimeoutMinutes([])).toBe(5);
  });

  it("a declared danger with no safety word has no category (the alert says 'Your report', never a guess)", () => {
    expect(safetyAlertOf([row({ body: "The garden bench needs paint" })], settings(), DEMO_NOW)?.category).toBeNull();
  });

  it("the newest open safety complaint counts", () => {
    const older = row({ id: "old", body: "fire in the basement", createdAt: new Date(DEMO_NOW - 60 * MIN) });
    const newer = row({ id: "new", body: "gas smell", createdAt: new Date(DEMO_NOW - MIN) });
    expect(safetyAlertOf([older, newer], settings(), DEMO_NOW)).toMatchObject({ state: "SENT", category: "GAS" });
  });

  it("flows into the Home data, and a resident's flat with no safety complaint has none", () => {
    const base = inputFor("T12-0408");
    const data = assembleHome({ ...base, complaints: [...base.complaints, row({ createdAt: new Date(DEMO_NOW - MIN) })] });
    expect(data.kind === "OK" && data.safetyAlert?.state).toBe("SENT");
    const plain = assembleHome({ ...base, complaints: base.complaints.map((c) => ({ ...c, safetyFlag: false })) });
    expect(plain.kind === "OK" && plain.safetyAlert).toBeNull();
  });

  it("the Home complaint carries its id, for the link to the detail page", () => {
    const data = assembleHome(inputFor("T12-0408"));
    expect(data.kind === "OK" && typeof data.complaint?.id).toBe("string");
  });
});
