import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import NotFound from "@/app/not-found";
import { t } from "@/lib/messages";

const html = renderToStaticMarkup(h(NotFound));

describe("A-006 the page for an unknown address", () => {
  it("has one h1, a main landmark and the sentence of the message catalog", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("<main");
    expect(html).toContain(">This page does not exist.</h1>");
    expect(html).toContain("Check the address, or go back to the home page.");
  });

  it("has exactly one link, filled, to the home page, at least 48px tall", () => {
    const links = html.match(/<a [^>]*>[^<]*<\/a>/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('href="/"');
    expect(links[0]).toContain("bg-accent");
    expect(links[0]).toContain("min-h-12");
    expect(links[0]).toContain(">Go to the home page</a>");
  });

  it("reads every word from the message catalog and shows no technical word", () => {
    for (const key of ["notFound.title", "notFound.body", "notFound.home"] as const) expect(html).toContain(t(key).replace(/'/g, "&#x27;"));
    expect(html).not.toMatch(/404|error|exception|stack/i);
  });
});
