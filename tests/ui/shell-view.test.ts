import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ForbiddenPage from "@/app/forbidden/page";
import { ProfileView } from "@/app/(resident)/profile/profile-view";
import { StaffView, permissionLabel } from "@/app/(staff)/staff/staff-view";
import { BottomNavView } from "@/components/bottom-nav";
import { enabledNavItems } from "@/lib/nav";
import { maskPhoneForDisplay, type ProfileData } from "@/server/profile/profile-data";

// The sign-out buttons use the router, which exists only in a running app.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const profile: ProfileData = { name: "Swati Joshi", phoneMasked: "******0007", role: "RESIDENT", flats: [{ code: "T12-0408", relation: "TENANT" }] };

describe("HM5 bottom navigation", () => {
  const out = html(h(BottomNavView, { items: enabledNavItems(), activeKey: "home" }));

  it("is a labelled nav landmark with exactly the enabled items, in words", () => {
    expect(out).toContain('<nav aria-label="Main navigation"');
    expect(count(out, /<li/g)).toBe(3);
    expect(out).toContain(">Home<");
    expect(out).toContain(">Complaints<");
    expect(out).toContain(">Profile<");
    expect(out).not.toContain("Bills");
  });

  it("marks the active item with aria-current and every item is at least 48px tall", () => {
    expect(count(out, /aria-current="page"/g)).toBe(1);
    expect(out).toMatch(/href="\/"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/"/);
    expect(count(out, /min-h-14/g)).toBe(3);
  });

  it("draws an icon above each label, hidden from screen readers, and marks the active item with a top bar and a tint", () => {
    expect(count(out, /<svg[^>]*aria-hidden="true"/g)).toBe(3);
    expect(out).toMatch(/<a [^>]*class="[^"]*flex-col[^"]*"[^>]*><svg/);
    expect(out).toContain("aria-[current=page]:border-accent");
    expect(out).toContain("aria-[current=page]:bg-paper-2");
    expect(out).not.toContain("underline");
  });

  it("draws four items when all are enabled, and none is active when the path is unknown", () => {
    const all = enabledNavItems(enabledNavItemsAll());
    expect(count(html(h(BottomNavView, { items: all, activeKey: null })), /<li/g)).toBe(4);
    expect(html(h(BottomNavView, { items: all, activeKey: null }))).not.toContain("aria-current");
  });
});

function enabledNavItemsAll() {
  return [
    { key: "home" as const, labelKey: "nav.home" as const, href: "/", enabled: true },
    { key: "bills" as const, labelKey: "nav.bills" as const, href: "/bills", enabled: true },
    { key: "complaints" as const, labelKey: "nav.complaints" as const, href: "/complaints", enabled: true },
    { key: "profile" as const, labelKey: "nav.profile" as const, href: "/profile", enabled: true },
  ];
}

describe("HM5 Profile", () => {
  const out = html(h(ProfileView, { data: profile, demoNote: null }));

  it("has one h1 and a main landmark, with the name, the masked phone, the role and each flat with its relation", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("<main");
    expect(out).toContain("Swati Joshi");
    expect(out).toContain("******0007");
    expect(out).toContain("Resident");
    expect(out).toContain("T12-0408");
    expect(out).toContain("Tenant");
  });

  it("never shows a full phone number", () => {
    expect(out).not.toMatch(/\d{10}/);
    expect(out).not.toMatch(/\d{5}\s?\d{5}/);
  });

  it("has Sign out and Sign out of all devices buttons", () => {
    expect(out).toContain("Sign out");
    expect(out).toContain("Sign out of all devices");
    expect(count(out, /<button/g)).toBe(2);
  });

  it("with no flat, says so", () => {
    expect(html(h(ProfileView, { data: { ...profile, flats: [] }, demoNote: null }))).toContain("No flat is linked to your account yet.");
  });

  it("D97 shows the section 'About this demo data' only when asked (demo mode), and not otherwise", () => {
    expect(out).not.toContain("About this demo data");
    const withNote = html(h(ProfileView, { data: profile, demoNote: { frozenOn: null } }));
    expect(withNote).toContain("About this demo data");
    expect(withNote).not.toContain("DEMO_AS_OF");
  });

  it("lists several flats in the order given", () => {
    const two = html(h(ProfileView, { data: { ...profile, flats: [{ code: "T07-1203", relation: "OWNER" }, { code: "T12-0408", relation: "FAMILY" }] }, demoNote: null }));
    expect(two.indexOf("T07-1203")).toBeLessThan(two.indexOf("T12-0408"));
    expect(two).toContain("Owner");
    expect(two).toContain("Family");
  });
});

describe("HM5 staff landing page", () => {
  const out = html(h(StaffView, { name: "Priya Nair", permissions: ["payments:match", "reports:view"] }));

  it("has one h1 and a main landmark, the name, the permissions in words, and a Sign out button", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("<main");
    expect(out).toContain("Signed in as Priya Nair");
    expect(out).toContain("Match bank payments");
    expect(out).toContain("View reports");
    expect(out).toContain(">Sign out<");
    expect(out).not.toContain("Sign out of all devices");
  });

  it("lists the tools the person may use: Bank statement matching for payments:match, the Committee report for reports:view, and a calm sentence for a person without a tool", () => {
    expect(out).toMatch(/<a [^>]*href="\/staff\/reconciliation"[^>]*>Open reconciliation<\/a>/);
    expect(out).toMatch(/<a [^>]*href="\/staff\/reports"[^>]*>Open the report<\/a>/);
    const reports = html(h(StaffView, { name: "Meera Kapoor", permissions: ["reports:view"] }));
    expect(reports).not.toContain("Bank statement matching");
    expect(reports).toMatch(/<a [^>]*href="\/staff\/reports"[^>]*>Open the report<\/a>/);
    const approver = html(h(StaffView, { name: "Rahul Menon", permissions: ["payments:approve"] }));
    expect(approver).toContain("You do not have access to any tools yet. Ask the society office.");
    expect(approver).not.toContain("href=");
  });

  it("with no permissions says so calmly and still has Sign out; an unknown permission is shown as stored", () => {
    const none = html(h(StaffView, { name: "N", permissions: [] }));
    expect(none).toContain("You do not have access to any tools yet. Ask the society office.");
    expect(none).toContain(">Sign out<");
    expect(none).not.toContain("<details");
    expect(permissionLabel("something:new")).toBe("something:new");
  });

  it.each([
    ["payments:match", "Match bank payments"],
    ["payments:approve", "Approve large payments"],
    ["reports:view", "View reports"],
    ["complaints:manage", "Manage complaints"],
    ["complaints:duty_manager", "Act as duty manager"],
  ])("%s reads %s", (permission, text) => {
    expect(permissionLabel(permission)).toBe(text);
  });
});

describe("HM5 forbidden page", () => {
  const out = html(h(ForbiddenPage));
  it("has one h1, a main landmark, a plain message and a link home of at least 48px", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("<main");
    expect(out).toContain("You cannot open this page");
    expect(out).toMatch(/<a [^>]*href="\/"/);
    expect(out).toContain("min-h-12");
  });
});

describe("HM5 maskPhoneForDisplay", () => {
  it.each([["5000000007", "******0007"], ["9876543210", "******3210"], ["1234", "1234"], ["12", "12"]])("%s is %s", (phone, masked) => {
    expect(maskPhoneForDisplay(phone)).toBe(masked);
  });
});
