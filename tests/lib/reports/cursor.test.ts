import { describe, expect, it } from "vitest";
import { type AgeingFlatRow, type AgeingSort, compareFlats } from "@/domain/reports/age";
import { createPrng } from "@/domain/seed/prng";
import { AGEING_PAGE_SIZE, decodeCursor, encodeCursor, pageAfter } from "@/lib/reports/cursor";

/** 60 flats with many ties: four amounts and four ages, so both orders must break ties by flat code. */
const prng = createPrng(1802);
const flats: AgeingFlatRow[] = Array.from({ length: 60 }, (_, i) => ({
  flatId: `id-${String(i).padStart(3, "0")}`,
  flatCode: `T${String(i % 12).padStart(2, "0")}-${String(i).padStart(4, "0")}`,
  bills: 1 + (i % 3),
  oldestDaysPastDue: 31 + prng.int(0, 3),
  amountDuePaise: BigInt(100_000 * (1 + prng.int(0, 3))),
}));
const ordered = (sort: AgeingSort) => [...flats].sort(compareFlats(sort));

describe("RC2 the drill-down order and paging (D180)", () => {
  it("both orders are total: no two flats compare equal, and largest first really is largest first", () => {
    for (const sort of ["LARGEST", "OLDEST"] as const) {
      const rows = ordered(sort);
      for (let i = 1; i < rows.length; i++) expect(compareFlats(sort)(rows[i - 1], rows[i]), `${sort} ${i}`).toBeLessThan(0);
    }
    const amounts = ordered("LARGEST").map((r) => r.amountDuePaise);
    expect(amounts).toEqual([...amounts].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    const days = ordered("OLDEST").map((r) => r.oldestDaysPastDue);
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });

  it("a cursor round-trips and a bad one is refused", () => {
    const place = decodeCursor(encodeCursor("OLDEST", flats[7]));
    expect(place).toMatchObject({ sort: "OLDEST", row: { flatId: flats[7].flatId, flatCode: flats[7].flatCode, oldestDaysPastDue: flats[7].oldestDaysPastDue, amountDuePaise: flats[7].amountDuePaise } });
    const bad = ["", "abc", "e30", Buffer.from("[]").toString("base64url"), Buffer.from('{"s":"LARGEST","a":"x","d":1,"f":"a","i":"b"}').toString("base64url"), Buffer.from('{"s":"NEWEST","a":"1","d":1,"f":"a","i":"b"}').toString("base64url"), "x".repeat(400)];
    for (const cursor of bad) expect(decodeCursor(cursor), cursor.slice(0, 12)).toBeNull();
  });

  it.each([1, 3, 7, 25])("pages of %i follow each other with no repeat and no gap, to the end, in both orders (ties included)", (size) => {
    for (const sort of ["LARGEST", "OLDEST"] as const) {
      const rows = ordered(sort);
      const seen: string[] = [];
      let place = null as ReturnType<typeof decodeCursor>;
      for (let guard = 0; guard < 100; guard++) {
        const result = pageAfter(rows, sort, place, size);
        seen.push(...result.rows.map((r) => r.flatId));
        if (result.nextCursor === null) break;
        expect(result.rows).toHaveLength(size);
        place = decodeCursor(result.nextCursor);
      }
      expect(seen, `${sort} size ${size}`).toEqual(rows.map((r) => r.flatId));
    }
  });

  it("a short list has one page and no cursor; an empty list has none", () => {
    expect(pageAfter(ordered("LARGEST").slice(0, AGEING_PAGE_SIZE), "LARGEST", null).nextCursor).toBeNull();
    expect(pageAfter(ordered("LARGEST").slice(0, AGEING_PAGE_SIZE + 1), "LARGEST", null).nextCursor).not.toBeNull();
    expect(pageAfter([], "LARGEST", null)).toEqual({ rows: [], nextCursor: null });
  });
});
