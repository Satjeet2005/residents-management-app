import { describe, expect, it } from "vitest";
import { NAV_ITEMS, activeNavKey, enabledNavItems } from "@/lib/nav";

describe("HM4 navigation config", () => {
  it("lists four items in a fixed order, each with a message key and an address", () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(["home", "bills", "complaints", "profile"]);
    for (const item of NAV_ITEMS) {
      expect(item.labelKey).toBe(`nav.${item.key}`);
      expect(item.href.startsWith("/")).toBe(true);
    }
  });

  it("only Home and Profile are enabled now: Bills and Complaints are not drawn until their features exist", () => {
    expect(enabledNavItems().map((i) => i.key)).toEqual(["home", "profile"]);
    expect(NAV_ITEMS.filter((i) => !i.enabled).map((i) => i.key)).toEqual(["bills", "complaints"]);
  });

  it("a switched-on item appears in its place", () => {
    const all = NAV_ITEMS.map((i) => ({ ...i, enabled: true }));
    expect(enabledNavItems(all).map((i) => i.key)).toEqual(["home", "bills", "complaints", "profile"]);
  });

  it.each([
    ["/", "home"],
    ["/profile", "profile"],
    ["/profile/edit", "profile"],
    ["/profilex", null],
    ["/staff", null],
    ["/bills", null],
  ])("the active item for %s is %s while only Home and Profile are enabled", (path, key) => {
    expect(activeNavKey(path)).toBe(key);
  });

  it("with every item enabled, /bills/2026-09 is Bills and / is only Home", () => {
    const all = NAV_ITEMS.map((i) => ({ ...i, enabled: true }));
    expect(activeNavKey("/bills/2026-09", all)).toBe("bills");
    expect(activeNavKey("/", all)).toBe("home");
    expect(activeNavKey("/complaints", all)).toBe("complaints");
  });
});
