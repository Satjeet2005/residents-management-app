import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmergencyButton, EmergencySheetContent } from "@/components/emergency-sheet";
import { telHref } from "@/lib/phone-link";

const html = renderToStaticMarkup;
const sheet = (numbers: { dutyManagerPhone: string | null; emergencyServicesPhone: string | null }) => html(h(EmergencySheetContent, { numbers }));

describe("HM5 the Emergency sheet (D43)", () => {
  const out = sheet({ dutyManagerPhone: "5900000001", emergencyServicesPhone: null });

  it("says what to do, in the words of the design", () => {
    expect(out).toContain("If someone is in danger, call the duty manager now.");
    expect(out).toContain("Call duty manager");
  });

  it("the duty manager link is a tel: address from the setting and is a large (56px) filled link", () => {
    expect(out).toMatch(/<a [^>]*href="tel:5900000001"/);
    expect(out).toContain("min-h-14");
    expect(out).toContain("bg-accent");
  });

  it("has the two lists with their items", () => {
    expect(out).toContain(">Call now<");
    for (const item of ["Fire", "Gas smell", "Someone stuck in a lift", "Electric shock", "Someone is hurt"]) expect(out).toContain(item);
    expect(out).toContain(">Raise a complaint<");
    for (const item of ["Water leak", "Lift not working with nobody inside", "Noise", "Parking"]) expect(out).toContain(item);
  });

  it("is laid out as two columns: Call now with a phone icon, Raise a complaint with a chat icon", () => {
    expect(out).toContain("grid grid-cols-2");
    const columns = out.split("<section").slice(1);
    expect(columns).toHaveLength(2);
    expect(columns[0]).toMatch(/<h3[^>]*border-b-2 border-ink[^>]*><svg[\s\S]*?<\/svg>Call now<\/h3>/);
    expect(columns[1]).toMatch(/<h3[^>]*border-b border-hairline[^>]*><svg[\s\S]*?<\/svg>Raise a complaint<\/h3>/);
    expect(columns[0]).toContain("M5 3h4l2 5");
    expect(columns[1]).toContain("M4 5h16v11H11l-4 4v-4H4z");
  });

  it("separates the items with hairlines, one row each", () => {
    expect((out.match(/<li class="border-b border-hairline text-body( py-3)?">/g) ?? []).length).toBe(9);
  });

  it("the large Call duty manager link is in the accent colour with a phone icon", () => {
    expect(out).toMatch(/<a class="[^"]*bg-accent[^"]*" href="tel:5900000001"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Call duty manager<\/a>/);
  });

  it("the four 'Raise a complaint' items are links to /complaints/new, each at least 48px tall", () => {
    const column = out.split("<section")[2].split("</section>")[0];
    const links = column.match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link).toContain('href="/complaints/new"');
      expect(link).toContain("min-h-12");
      expect(link).toContain("my-1");
    }
  });

  it("'Not an emergency?' is followed by an outlined 'Raise a complaint' link to /complaints/new, not a filled one", () => {
    expect(out).toContain("Not an emergency?");
    const button = /<a [^>]*>Raise a complaint<\/a>/.exec(out)?.[0] ?? "";
    expect(button).toContain('href="/complaints/new"');
    expect(button).toContain("border-control");
    expect(button).not.toContain("bg-accent");
    expect(out).not.toContain("<button");
  });

  it("has exactly one filled control: Call duty manager", () => {
    expect((out.match(/bg-accent/g) ?? []).length).toBe(1);
  });

  it("shows nothing for emergency services while that setting is null", () => {
    expect(out).not.toContain("emergency services");
    expect(out).not.toContain("Call emergency services");
  });

  it("with the emergency services number set, shows a second tel: link, outlined", () => {
    const both = sheet({ dutyManagerPhone: "5900000001", emergencyServicesPhone: "112" });
    expect(both).toMatch(/<a [^>]*href="tel:112"/);
    expect(both).toContain("Call emergency services");
    expect((both.match(/href="tel:/g) ?? []).length).toBe(2);
  });

  it("with no duty manager number, says so and draws no link to nowhere", () => {
    const none = sheet({ dutyManagerPhone: null, emergencyServicesPhone: null });
    expect(none).toContain("The duty manager&#x27;s number is not set");
    expect(none).not.toContain("tel:");
  });

  it("the Emergency control is outlined, never filled", () => {
    const button = html(h(EmergencyButton, { numbers: { dutyManagerPhone: "5900000001", emergencyServicesPhone: null } }));
    const control = /<button[^>]*>(?:(?!<\/button>).)*Emergency<\/button>/.exec(button)?.[0] ?? "";
    expect(control).toContain("border-control");
    expect(control).not.toContain("bg-accent");
    expect(control).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("the sheet is a dialog titled Emergency help, with a Close button, closed until opened", () => {
    const button = html(h(EmergencyButton, { numbers: { dutyManagerPhone: "5900000001", emergencyServicesPhone: null } }));
    expect(button).toContain("<dialog");
    expect(button).toContain("Emergency help");
    expect(button).toContain("Close");
    expect(button).not.toMatch(/<dialog[^>]*\sopen(?=[\s>=])/);
  });
});

describe("HM5 telHref", () => {
  it.each([
    ["5900000001", "tel:5900000001"],
    ["+91 98765 43210", "tel:+919876543210"],
    ["(022) 2345-6789", "tel:02223456789"],
    [" 112 ", "tel:112"],
    ["+91+98765", "tel:+9198765"],
    ["call me", null],
    ["", null],
    ["   ", null],
    ["+", null],
    [null, null],
  ])("%j is %j", (phone, expected) => {
    expect(telHref(phone)).toBe(expected);
  });

  it("never carries a script or a space into the address", () => {
    expect(telHref('1" onclick="x')).toBe("tel:1");
  });
});
