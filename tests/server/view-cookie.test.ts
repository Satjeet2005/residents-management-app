import { describe, expect, it } from "vitest";
import { VIEW_COOKIE, VIEW_COOKIE_MAX_BYTES } from "@/lib/reports/sections";
import { applySectionChoice, hiddenSectionsInput } from "@/server/reports/view-cookie";

type Call = { op: "set" | "delete"; args: unknown[] };
const jar = () => {
  const calls: Call[] = [];
  return { calls, set: (...args: unknown[]) => calls.push({ op: "set", args }), delete: (...args: unknown[]) => calls.push({ op: "delete", args }) };
};
const SAME = new Headers({ host: "localhost:3000", origin: "http://localhost:3000" });
const run = (raw: unknown, headers: Headers = SAME, secure = false) => {
  const j = jar();
  const result = applySectionChoice({ raw, headers, secure, jar: j });
  return { result, calls: j.calls };
};

describe("VC1 the zod input", () => {
  it("accepts at most five distinct ids from the allowlist", () => {
    expect(hiddenSectionsInput.safeParse([]).success).toBe(true);
    expect(hiddenSectionsInput.safeParse(["money", "bank"]).success).toBe(true);
    expect(hiddenSectionsInput.safeParse(["money", "owed", "quality", "complaints", "bank"]).success).toBe(true);
  });

  it.each([
    ["six ids", ["money", "owed", "quality", "complaints", "bank", "money"]],
    ["a repeated id", ["money", "money"]],
    ["an unknown id", ["money", "cards"]],
    ["a string", "money,bank"],
    ["an object", { money: true }],
    ["null", null],
    ["a number in the list", [1]],
  ])("refuses %s", (_name, value) => {
    expect(hiddenSectionsInput.safeParse(value).success).toBe(false);
  });
});

describe("VC2 saving the choice", () => {
  it("sets committee_view for the staff pages only: HttpOnly, SameSite=Lax, one year, at most 80 bytes", () => {
    const { result, calls } = run(["bank", "money"]);
    expect(result).toBe("SAVED");
    expect(calls).toHaveLength(1);
    const [name, value, options] = calls[0].args as [string, string, Record<string, unknown>];
    expect(name).toBe(VIEW_COOKIE);
    expect(value).toBe("money,bank");
    expect(options).toEqual({ path: "/staff", httpOnly: true, sameSite: "lax", secure: false, maxAge: 31_536_000 });
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(VIEW_COOKIE_MAX_BYTES);
  });

  it("is Secure when the request came over https", () => {
    const { calls } = run(["money"], SAME, true);
    expect((calls[0].args[2] as { secure: boolean }).secure).toBe(true);
  });

  it("an empty choice ('Show everything') deletes the cookie at the same path", () => {
    const { result, calls } = run([]);
    expect(result).toBe("SAVED");
    expect(calls).toEqual([{ op: "delete", args: [{ name: VIEW_COOKIE, path: "/staff" }] }]);
  });

  it("an invalid choice changes nothing", () => {
    for (const raw of [["secrets"], "money", ["money", "money"], undefined]) {
      const { result, calls } = run(raw);
      expect(result).toBe("INVALID");
      expect(calls).toEqual([]);
    }
  });

  it("a request from another site is refused and changes nothing, even with a valid choice", () => {
    for (const headers of [new Headers({ host: "localhost:3000", origin: "https://evil.example" }), new Headers({ host: "localhost:3000", "sec-fetch-site": "cross-site" }), new Headers({ host: "localhost:3000", origin: "null" })]) {
      const { result, calls } = run(["money"], headers);
      expect(result).toBe("REFUSED");
      expect(calls).toEqual([]);
    }
  });
});
