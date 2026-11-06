import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ResidentError from "@/app/(resident)/error";
import Loading from "@/app/(resident)/loading";
import { HomeView } from "@/app/(resident)/home-view";
import { assembleHome } from "@/server/home/mapper";
import { inputFor } from "../server/home-fixtures";

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const plain = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("HM5 loading state", () => {
  const out = html(h(Loading));
  it("is skeleton blocks marked busy, with one h1 and a main landmark, and no spinner or shimmer", () => {
    expect(out).toContain('aria-busy="true"');
    expect(count(out, /aria-busy="true"/g)).toBe(3);
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("<main");
    expect(out).not.toMatch(/animate-|spin|shimmer/);
  });
  it("tells a screen reader that it is loading", () => {
    expect(plain(out)).toContain("Loading");
  });
});

describe("HM5 error state", () => {
  const out = html(h(ResidentError, { error: new Error("password authentication failed for user township_app"), reset: () => {} }));
  it("says what failed and what the resident cannot do, in an alert, with a 48px Try again button", () => {
    expect(out).toContain('role="alert"');
    expect(plain(out)).toContain("We couldn't load your dues.");
    expect(plain(out)).toContain("You can't pay right now.");
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Try again<\/button>/);
  });
  it("has one h1 and a main landmark, and never shows the error message itself", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("<main");
    expect(out).not.toContain("password authentication");
    expect(out).not.toContain("township_app");
  });
});

describe("HM5 empty states", () => {
  it("a flat with no ledger entry says No dues and No activity yet, and has no breakdown", () => {
    const text = plain(html(h(HomeView, { data: assembleHome({ ...inputFor("T07-1203"), bills: [], entries: [] }) })));
    expect(text).toContain("No dues");
    expect(text).toContain("No activity yet");
    expect(text).not.toContain("See what makes up this amount");
  });
  it("a person with no flat gets an explanation, not an empty screen", () => {
    const text = plain(html(h(HomeView, { data: assembleHome({ ...inputFor("T07-1203"), memberships: [] }) })));
    expect(text).toContain("No flat is linked to your account yet");
  });
});
