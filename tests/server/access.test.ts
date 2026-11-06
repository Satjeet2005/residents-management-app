import { describe, expect, it } from "vitest";
import { FORBIDDEN_PATH, decideAccess, loginPath, requireUserWith } from "@/server/auth/access";
import { isAllowed, type Need } from "@/server/auth/guard";
import type { SessionUser } from "@/server/auth/session-service";

const user = (over: Partial<SessionUser> = {}): SessionUser => ({ id: "u1", name: "N", phone: "5000000001", role: "STAFF", active: true, permissions: [], ...over });
const staff = (...permissions: string[]) => user({ permissions });
const resident = (permissions: string[] = []) => user({ role: "RESIDENT", permissions });

/** `redirect()` throws an error whose digest names the target; a test reads it from there. */
async function redirectTarget(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    return digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : null;
  }
}

describe("D81 isAllowed", () => {
  const cases: [string, SessionUser, Need, boolean][] = [
    ["staff, ANY_USER", staff(), "ANY_USER", true],
    ["resident, ANY_USER", resident(), "ANY_USER", true],
    ["staff, STAFF", staff(), "STAFF", true],
    ["resident, STAFF", resident(), "STAFF", false],
    ["staff, RESIDENT", staff(), "RESIDENT", false],
    ["resident, RESIDENT", resident(), "RESIDENT", true],
    ["staff with the permission", staff("payments:match"), "payments:match", true],
    ["staff with another permission", staff("reports:view"), "payments:match", false],
    ["staff with none", staff(), "payments:match", false],
    ["a resident that holds every permission string", resident(["payments:match", "payments:approve"]), "payments:match", false],
    ["inactive staff with the permission", user({ active: false, permissions: ["payments:match"] }), "payments:match", false],
    ["inactive staff, STAFF", user({ active: false }), "STAFF", false],
    ["inactive resident, RESIDENT", user({ role: "RESIDENT", active: false }), "RESIDENT", false],
  ];
  it.each(cases)("%s -> %s", (_label, who, need, allowed) => {
    expect(isAllowed(who, need)).toBe(allowed);
  });
});

describe("D81 decideAccess", () => {
  it("no user means log in", () => {
    expect(decideAccess(null)).toEqual({ kind: "login" });
    expect(decideAccess(null, "STAFF")).toEqual({ kind: "login" });
  });
  it("a user who passes is ok, and a user who does not is forbidden", () => {
    expect(decideAccess(resident())).toEqual({ kind: "ok", user: resident() });
    expect(decideAccess(resident(), "STAFF")).toEqual({ kind: "forbidden" });
    expect(decideAccess(staff("reports:view"), "reports:view")).toEqual({ kind: "ok", user: staff("reports:view") });
  });
});

describe("D81 loginPath", () => {
  it.each([
    ["/staff/payments", "/login?returnTo=%2Fstaff%2Fpayments"],
    ["/a?b=c", "/login?returnTo=%2Fa%3Fb%3Dc"],
    [undefined, "/login?returnTo=%2F"],
    ["//evil.com", "/login?returnTo=%2F"],
    ["https://evil.com", "/login?returnTo=%2F"],
    ["/\\evil.com", "/login?returnTo=%2F"],
    ["/%2f%2fevil.com", "/login?returnTo=%2F"],
  ])("%s -> %s", (input, expected) => {
    expect(loginPath(input)).toBe(expected);
  });
});

describe("D81 requireUserWith", () => {
  it("returns the user who passes", async () => {
    await expect(requireUserWith(async () => staff("reports:view"), { need: "reports:view" })).resolves.toEqual(staff("reports:view"));
  });
  it("redirects to /login with a checked returnTo when there is no session", async () => {
    expect(await redirectTarget(requireUserWith(async () => null, { returnTo: "/staff/payments" }))).toBe("/login?returnTo=%2Fstaff%2Fpayments");
    expect(await redirectTarget(requireUserWith(async () => null, { returnTo: "//evil.com" }))).toBe("/login?returnTo=%2F");
    expect(await redirectTarget(requireUserWith(async () => null))).toBe("/login?returnTo=%2F");
  });
  it("redirects to /forbidden when the role or permission is wrong", async () => {
    expect(await redirectTarget(requireUserWith(async () => resident(), { need: "STAFF" }))).toBe(FORBIDDEN_PATH);
    expect(await redirectTarget(requireUserWith(async () => staff(), { need: "payments:approve" }))).toBe(FORBIDDEN_PATH);
  });
  it("a plain error from the lookup is not turned into a redirect", async () => {
    await expect(requireUserWith(async () => { throw new Error("db down"); })).rejects.toThrow("db down");
  });
});
