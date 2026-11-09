import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TowersBlock } from "@/app/(staff)/staff/reports/towers-block";
import type { TowerRollup, TowerRow } from "@/domain/reports/towers";
import { formatRupees } from "@/domain/money/money";
import { sortTowers, towerName, towerSortFromQuery, towersTable } from "@/lib/reports/towers";

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

describe("TW2 the towers block of the Dues page (D216)", () => {
  const out = html(h(TowersBlock, { rollup: many }));
  const text = words(out);

  it("is the heading followed DIRECTLY by a real table of the five towers that owe the most, no paragraph, no list", () => {
    expect(out).toMatch(/<h2[^>]*>Towers with the most unpaid<\/h2><div class="min-w-0"><table/);
    expect(count(out, /<tbody>[\s\S]*<\/tbody>/g)).toBe(1);
    expect(count(out.slice(out.indexOf("<tbody>")), /<tr /g)).toBe(5);
    expect(out).not.toMatch(/<p[ >]|<ul|<details|See all/);
    expect(text).toContain("Tower 12 ₹1,21,200 22 0");
    expect(text).toContain("Tower 8 ₹80,800 18 2");
    expect(text).not.toContain("Tower 7 ");
  });

  it("has the columns Tower, Owed, Flats owing and Over 90 days, all four shown on a phone, numbers right-aligned in tabular figures", () => {
    const heads = [...out.matchAll(/<th scope="col"([^>]*)>([^<]*)<\/th>/g)];
    expect(heads.map((m) => m[2])).toEqual(["Tower", "Owed", "Flats owing", "Over 90 days"]);
    for (const head of heads) expect(head[1]).not.toContain("hidden");
    expect(out).toContain('class="tnum w-full');
    expect(out.match(/<td class="[^"]*text-right/g)).toHaveLength(15);
  });

  it("an empty roll-up draws nothing", () => {
    expect(html(h(TowersBlock, { rollup: rollupOf([]) }))).toBe("");
  });

  it("names towers and counts only: no flat code, no name, no phone number, nothing filled", () => {
    expect(out).not.toMatch(/T\d\d-\d{4}/);
    expect(text).not.toMatch(/\d{10}/);
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });
});

describe("TW3 the table of all towers (the towers page)", () => {
  const owed = sortTowers(many.towers, "owed");
  const byName = sortTowers(many.towers, "tower");

  it("has Tower, Owed, Flats owing and Over 90 days on a phone, and Unpaid bills and Late fees from 768px, with a totals row that is Total owed", () => {
    const table = towersTable({ towers: owed, total: many.total }, true);
    expect(table.columns.map((c) => [c.label, c.phone])).toEqual([["Tower", true], ["Owed", true], ["Flats owing", true], ["Over 90 days", true], ["Unpaid bills", false], ["Late fees", false]]);
    expect(table.rows).toHaveLength(13);
    expect(table.rows[0]).toMatchObject({ header: "Tower 12", cells: ["₹1,21,200", "22", "0", "₹1,20,000", "₹1,200"] });
    expect(table.rows.at(-1)).toMatchObject({ header: "Total owed", total: true });
    expect(table.rows.at(-1)?.cells[0]).toBe(formatRupees(many.towers.reduce((sum, r) => sum + r.amountDuePaise, 0n)));
  });

  it("the order is the most owed first (as the roll-up gives it) or by tower name, and anything else in the address is the default", () => {
    expect(owed.map((r) => r.tower).slice(0, 3)).toEqual(["T12", "T11", "T10"]);
    expect(byName.map((r) => r.tower).slice(0, 3)).toEqual(["T01", "T02", "T03"]);
    expect(towerSortFromQuery("tower")).toBe("tower");
    for (const value of [undefined, "", "owed", "TOWER", "<script>", "tower,owed"]) expect(towerSortFromQuery(value), String(value)).toBe("owed");
    expect(towerSortFromQuery(["tower", "owed"])).toBe("tower");
  });
});

describe("TW4 names", () => {
  it("a tower code is Tower and its number; anything else is shown as it is", () => {
    expect(towerName("T09")).toBe("Tower 9");
    expect(towerName("T12")).toBe("Tower 12");
    expect(towerName("Block A")).toBe("Block A");
  });
});
