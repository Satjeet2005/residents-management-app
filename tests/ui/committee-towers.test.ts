import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TowersBlock } from "@/app/(staff)/staff/reports/towers-block";
import type { TowerRollup, TowerRow } from "@/domain/reports/towers";
import { towerName, towersTableOf } from "@/lib/reports/towers";

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const row = (n: number, over: Partial<TowerRow> = {}): TowerRow => ({ tower: `T${String(n).padStart(2, "0")}`, flats: 10 + n, bills: 12 + n, unpaidBillsPaise: BigInt(n) * 1_000_000n, lateFeesPaise: BigInt(n) * 10_000n, amountDuePaise: BigInt(n) * 1_010_000n, flatsOver90: n % 3, ...over });
const rollupOf = (towers: TowerRow[]): TowerRollup => ({
  towers,
  total: towers.reduce(
    (t, r) => ({ flats: t.flats + r.flats, bills: t.bills + r.bills, unpaidBillsPaise: t.unpaidBillsPaise + r.unpaidBillsPaise, lateFeesPaise: t.lateFeesPaise + r.lateFeesPaise, amountDuePaise: t.amountDuePaise + r.amountDuePaise, flatsOver90: t.flatsOver90 + r.flatsOver90 }),
    { flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n, flatsOver90: 0 },
  ),
});
const many = rollupOf(Array.from({ length: 12 }, (_, i) => row(12 - i)));

describe("TW2 the towers block", () => {
  const out = html(h(TowersBlock, { rollup: many }));
  const text = words(out);

  it("names the ten towers that owe the most, each with its flats owing, what it owes and its flats over 90 days", () => {
    expect(text).toContain("Towers with the most unpaid");
    expect(text).toContain("Tower 12 ₹1,21,200 22 flats owing · none over 90 days");
    expect(text).toContain("Tower 10 ₹1,01,000 20 flats owing · 1 flat over 90 days");
    expect(text).toContain("Tower 8 ₹80,800 18 flats owing · 2 flats over 90 days");
  });

  it("lists ten in the first list and the rest behind 'See all 12 towers', 48px", () => {
    const firstList = out.slice(out.indexOf("<ul"), out.indexOf("</ul>"));
    expect(count(firstList, /<li/g)).toBe(10);
    expect(out).toMatch(/<summary[^>]*min-h-12[^>]*>See all 12 towers<\/summary>/);
    const rest = out.slice(out.indexOf("<details>"), out.indexOf("</details>"));
    expect(count(rest, /<li/g)).toBe(2);
    expect(words(rest)).toContain("Tower 1 ");
  });

  it("ten towers or fewer have no 'See all' and an empty roll-up draws nothing", () => {
    expect(html(h(TowersBlock, { rollup: rollupOf(many.towers.slice(0, 10)) }))).not.toContain("See all");
    expect(html(h(TowersBlock, { rollup: rollupOf([]) }))).toBe("");
  });

  it("the numbers behind the list: every tower and a total row, six columns, exact rupees", () => {
    const table = towersTableOf(many);
    expect(table.columns).toEqual(["Tower", "Flats owing", "Unpaid bills", "Late fees", "Total", "Flats over 90 days"]);
    expect(table.rows).toHaveLength(13);
    expect(table.rows[0]).toEqual({ header: "Tower 12", cells: ["22", "₹1,20,000", "₹1,200", "₹1,21,200", "0"] });
    expect(table.rows.at(-1)?.header).toBe("Total owed");
    expect(out).toContain("See the numbers behind this chart");
  });

  it("names towers and counts only: no flat code, no name, no phone number", () => {
    expect(out).not.toMatch(/T\d\d-\d{4}/);
    expect(text).not.toMatch(/\d{10}/);
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });

  it("a tower code is Tower and its number; anything else is shown as it is", () => {
    expect(towerName("T09")).toBe("Tower 9");
    expect(towerName("T12")).toBe("Tower 12");
    expect(towerName("Block A")).toBe("Block A");
  });
});
