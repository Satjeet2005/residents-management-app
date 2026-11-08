import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmergencyButton, EmergencySheetContent } from "@/components/emergency-sheet";
import { formatPhone, telHref } from "@/lib/phone-link";

const html = renderToStaticMarkup;
const sheet = (numbers: { dutyManagerPhone: string | null; emergencyServicesPhone: string | null }) => html(h(EmergencySheetContent, { numbers }));

describe("HM5 the Emergency sheet is call-first (D43, D185)", () => {
  const out = sheet({ dutyManagerPhone: "5900000001", emergencyServicesPhone: null });

  it("says the lead sentence, the examples sentence and the not-an-emergency heading, in the words of the design", () => {
    expect(out).toContain("If someone is in danger, call now.");
    expect(out).toContain("Use this for fire, gas smell, someone stuck in a lift, electric shock, or someone hurt.");
    expect(out).toContain(">Not an emergency?<");
    expect(out).toContain("Water leak, lift not working, noise, parking and similar.");
  });

  it("the duty manager link is a tel: address from the setting, a large (56px) filled link, with the number as readable text under it", () => {
    expect(out).toMatch(/<a [^>]*href="tel:5900000001"/);
    expect(out).toContain("min-h-14");
    expect(out).toMatch(/<a class="[^"]*bg-accent[^"]*" href="tel:5900000001"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Call duty manager<\/a><p[^>]*>\+91 59000 00001<\/p>/);
  });

  it("has no columns, no list, no column headers and no underlined item", () => {
    expect(out).not.toContain("grid-cols-2");
    expect(out).not.toContain("<ul");
    expect(out).not.toContain("<li");
    expect(out).not.toContain("underline");
    expect(out).not.toContain(">Call now<");
  });

  it("has exactly two links, Call duty manager and Raise a complaint, and says Raise a complaint once", () => {
    expect((out.match(/<a /g) ?? []).length).toBe(2);
    expect((out.match(/Raise a complaint/g) ?? []).length).toBe(1);
    expect(out).not.toContain("<button");
  });

  it("the Raise a complaint link opens /complaints/new and is outlined, never filled", () => {
    const button = /<a [^>]*>Raise a complaint<\/a>/.exec(out)?.[0] ?? "";
    expect(button).toContain('href="/complaints/new"');
    expect(button).toContain("border-control");
    expect(button).not.toContain("bg-accent");
  });

  it("has exactly one filled control: Call duty manager", () => {
    expect((out.match(/bg-accent/g) ?? []).length).toBe(1);
  });

  it("never says 112 or dial (human decision)", () => {
    expect(out).not.toMatch(/\b112\b|dial/i);
  });

  it("shows nothing for emergency services while that setting is null", () => {
    expect(out).not.toContain("Emergency services");
  });

  it("with the emergency services number set, shows it as one plain text line, not a link", () => {
    const both = sheet({ dutyManagerPhone: "5900000001", emergencyServicesPhone: "112" });
    expect(both).toMatch(/<p[^>]*>Emergency services: 112<\/p>/);
    expect((both.match(/href="tel:/g) ?? []).length).toBe(1);
    const ten = sheet({ dutyManagerPhone: "5900000001", emergencyServicesPhone: "9876543210" });
    expect(ten).toContain("Emergency services: +91 98765 43210");
  });

  it("with no duty manager number, says so, draws no call button and no link to nowhere", () => {
    const none = sheet({ dutyManagerPhone: null, emergencyServicesPhone: null });
    expect(none).toContain("The duty manager&#x27;s number is not set up. Ask the society office.");
    expect(none).not.toContain("tel:");
    expect(none).not.toContain("Call duty manager");
    expect((none.match(/<a /g) ?? []).length).toBe(1);
    expect(none).not.toContain("bg-accent");
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

describe("HM5 formatPhone", () => {
  it.each([
    ["5900000001", "+91 59000 00001"],
    ["+91 98765 43210", "+91 98765 43210"],
    ["919876543210", "+91 98765 43210"],
    ["09876543210", "+91 98765 43210"],
    ["98765-43210", "+91 98765 43210"],
    ["112", "112"],
    [" 112 ", "112"],
    ["(022) 2345-6789", "(022) 2345-6789"],
    ["call me", null],
    ["022 2345 6789", "022 2345 6789"],
    ["", null],
    [null, null],
  ])("%j is shown as %j", (phone, expected) => {
    expect(formatPhone(phone)).toBe(expected);
  });

  it("never changes a digit: the digits of the text equal the digits of the input", () => {
    for (const phone of ["5900000001", "+919876543210", "09876543210", "112", "(022) 2345-6789", "98765 43210"]) {
      expect((formatPhone(phone) ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "")).toBe(phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""));
    }
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
