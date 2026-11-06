import { describe, expect, it } from "vitest";
import { clientIp } from "@/server/auth/client-ip";

const headers = (init: Record<string, string>) => new Headers(init);
const ON_VERCEL = { VERCEL: "1" };

describe("S-A2 clientIp on Vercel", () => {
  it.each([
    [{ "x-vercel-forwarded-for": "203.0.113.9" }, "203.0.113.9"],
    [{ "x-real-ip": "203.0.113.9" }, "203.0.113.9"],
    [{ "x-forwarded-for": "203.0.113.9" }, "203.0.113.9"],
    [{ "x-forwarded-for": "2001:DB8::1" }, "2001:db8::1"],
    [{ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }, "203.0.113.9"],
  ])("reads %j as %s", (init, expected) => {
    expect(clientIp(headers(init), ON_VERCEL)).toBe(expected);
  });

  it("prefers x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for", () => {
    const all = { "x-vercel-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" };
    expect(clientIp(headers(all), ON_VERCEL)).toBe("1.1.1.1");
    expect(clientIp(headers({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" }), ON_VERCEL)).toBe("2.2.2.2");
  });

  it.each([
    ["no header", {}],
    ["an empty value", { "x-forwarded-for": "" }],
    ["text that is not an address", { "x-forwarded-for": "evil<script>" }],
    ["a very long value", { "x-forwarded-for": "1".repeat(100) }],
    ["an address with a space inside", { "x-forwarded-for": "1.2.3 .4" }],
  ])("gives unknown for %s", (_label, init) => {
    expect(clientIp(headers(init), ON_VERCEL)).toBe("unknown");
  });

  it("skips an unusable header and uses the next one", () => {
    expect(clientIp(headers({ "x-vercel-forwarded-for": "bad value", "x-real-ip": "2.2.2.2" }), ON_VERCEL)).toBe("2.2.2.2");
  });
});

describe("S-A2 clientIp off Vercel", () => {
  it.each([{}, { VERCEL: "0" }, { VERCEL: "true" }])("does not trust the headers when env is %j", (env) => {
    const spoofed = headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6", "x-vercel-forwarded-for": "6.6.6.6" });
    expect(clientIp(spoofed, env)).toBe("unknown");
  });
});
