import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { ProfileView } from "@/app/(resident)/profile/profile-view";
import { LoginScreen } from "@/app/login/login-screen";
import type { DemoNoteState } from "@/lib/demo-note";
import { demoNoteState } from "@/server/demo-note";
import { home } from "../server/home-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), usePathname: () => "/", redirect: () => {} }));

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const FROZEN: DemoNoteState = { frozenOn: "27 October 2026" };
const LIVE: DemoNoteState = { frozenOn: null };
const profile = { name: "Swati Joshi", phoneMasked: "******0007", role: "RESIDENT" as const, flats: [{ code: "T12-0408", relation: "TENANT" as const }] };

const screens: [string, (note: DemoNoteState | null) => string][] = [
  ["login", (note) => renderToStaticMarkup(h(LoginScreen, { demoNote: note, returnTo: null }))],
  ["home", (note) => renderToStaticMarkup(h(HomeView, { data: home("T12-0408"), demoNote: note }))],
  ["profile", (note) => renderToStaticMarkup(h(ProfileView, { data: profile, demoNote: note }))],
];

describe("D230 the demo note on the login screen, the Home and the Profile", () => {
  it.each(screens)("%s: no note without demo mode", (_name, render) => {
    expect(text(render(null))).not.toMatch(/demo/i);
  });

  it.each(screens)("%s: the frozen wording names the date and says codes and sessions use real time", (_name, render) => {
    const words = text(render(FROZEN));
    expect(words).toMatch(/business date is fixed at 27 October 2026/);
    expect(words).toMatch(/client's sample table/);
    expect(words).toMatch(/(Sign-in codes|Codes) and sessions use real time\./);
  });

  it.each(screens)("%s: the unfrozen wording says the data was created as of 27 October 2026 and names no setting", (_name, render) => {
    const words = text(render(LIVE));
    expect(words).toContain("created as of 27 October 2026");
    expect(words).toContain("overdue days and late fees are higher");
    expect(words).not.toMatch(/fixed at/);
  });

  it.each(screens)("%s: no environment variable name in either wording", (_name, render) => {
    for (const note of [FROZEN, LIVE]) expect(text(render(note))).not.toMatch(/DEMO_|[A-Z]{3,}_[A-Z]{2,}|set\s+\w+=/);
  });

  it("the full note carries a heading on the login screen and the Profile, and the Home has the one-line version without a heading", () => {
    expect(text(screens[0][1](FROZEN))).toContain("About this demo data");
    expect(text(screens[2][1](FROZEN))).toContain("About this demo data");
    expect(text(screens[1][1](FROZEN))).not.toContain("About this demo data");
  });
});

describe("D230 the Home note is one short line at the very bottom", () => {
  const homeHtml = (note: DemoNoteState | null) => screens[1][1](note);

  it.each([[FROZEN], [LIVE]])("is at most 25 words and one paragraph (%j)", (note) => {
    const html = homeHtml(note);
    const paragraphs = [...html.matchAll(/<p class="text-caption text-ink-2">([^<]*Demo[^<]*)<\/p>/g)];
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0][1].replace(/&#x27;/g, "'").trim().split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it.each([[FROZEN], [LIVE]])("comes after Recent activity and after the Pay button, so it cannot push the primary action down (%j)", (note) => {
    const html = homeHtml(note);
    const note_ = html.indexOf("Demo ");
    const pay = html.search(/>Pay ₹/);
    expect(pay).toBeGreaterThan(0);
    expect(html.indexOf("Recent activity")).toBeGreaterThan(pay);
    expect(note_).toBeGreaterThan(html.indexOf("Recent activity"));
  });

  it("the page above the note is byte for byte the same with and without the note", () => {
    const without = homeHtml(null);
    const withNote = homeHtml(FROZEN);
    expect(withNote.startsWith(without.slice(0, without.lastIndexOf("</section>") + "</section>".length))).toBe(true);
  });
});

describe("D230 the page decides the wording from the environment", () => {
  it("frozen and unfrozen environments give the two wordings through the real function", () => {
    expect(text(screens[0][1](demoNoteState({ DEMO_MODE: "true", DEMO_AS_OF: "2026-10-27" })))).toContain("fixed at 27 October 2026");
    expect(text(screens[0][1](demoNoteState({ DEMO_MODE: "true" })))).toContain("created as of 27 October 2026");
    expect(text(screens[0][1](demoNoteState({ DEMO_MODE: "false", DEMO_AS_OF: "2026-10-27" })))).not.toMatch(/demo/i);
  });
});
