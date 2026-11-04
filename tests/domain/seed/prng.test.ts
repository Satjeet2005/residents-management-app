import { describe, expect, it } from "vitest";
import { createPrng } from "@/domain/seed/prng";

const SEED = 20261027;

describe("createPrng", () => {
  it("matches an independent mulberry32 implementation (reference values from a separate port)", () => {
    const rng = createPrng(SEED);
    expect([rng.next(), rng.next(), rng.next(), rng.next(), rng.next()]).toEqual([
      0.4168327304068953, 0.8087772198487073, 0.5520388591103256, 0.8617698752786964, 0.306728751398623,
    ]);
    const other = createPrng(1);
    expect([other.next(), other.next(), other.next()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it("gives the same sequence for the same seed and a different one for another seed", () => {
    const a = Array.from({ length: 50 }, ((rng) => () => rng.next())(createPrng(SEED)));
    const b = Array.from({ length: 50 }, ((rng) => () => rng.next())(createPrng(SEED)));
    const c = Array.from({ length: 50 }, ((rng) => () => rng.next())(createPrng(SEED + 1)));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("next() stays in [0, 1)", () => {
    const rng = createPrng(SEED);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next();
      expect(value >= 0 && value < 1).toBe(true);
    }
  });

  it("rejects a non-integer seed", () => {
    expect(() => createPrng(1.5)).toThrow(RangeError);
    expect(() => createPrng(Number.NaN)).toThrow(RangeError);
  });
});

describe("int", () => {
  it("covers every value from min to max inclusive and nothing else", () => {
    const rng = createPrng(SEED);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(3, 7));
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("allows min equal to max and negative ranges", () => {
    const rng = createPrng(SEED);
    expect(rng.int(5, 5)).toBe(5);
    for (let i = 0; i < 200; i++) expect(rng.int(-3, -1)).toBeLessThanOrEqual(-1);
  });

  it.each([[2, 1], [1.5, 3], [1, Number.NaN]])("rejects int(%s, %s)", (min, max) => {
    expect(() => createPrng(SEED).int(min, max)).toThrow(RangeError);
  });
});

describe("pick", () => {
  it("returns members of the list and uses all of them", () => {
    const rng = createPrng(SEED);
    const list = ["a", "b", "c", "d"];
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(rng.pick(list));
    expect([...seen].sort()).toEqual(list);
  });

  it("rejects an empty list", () => {
    expect(() => createPrng(SEED).pick([])).toThrow(RangeError);
  });
});

describe("weighted", () => {
  it("follows the weights", () => {
    const rng = createPrng(SEED);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 30_000; i++) {
      counts[rng.weighted([{ value: "a" as const, weight: 1 }, { value: "b" as const, weight: 2 }, { value: "c" as const, weight: 7 }])]++;
    }
    expect(counts.a / 30_000).toBeGreaterThan(0.09);
    expect(counts.a / 30_000).toBeLessThan(0.11);
    expect(counts.b / 30_000).toBeGreaterThan(0.19);
    expect(counts.b / 30_000).toBeLessThan(0.21);
    expect(counts.c / 30_000).toBeGreaterThan(0.68);
    expect(counts.c / 30_000).toBeLessThan(0.72);
  });

  it("never picks a zero-weight value", () => {
    const rng = createPrng(SEED);
    for (let i = 0; i < 1000; i++) {
      expect(rng.weighted([{ value: "never", weight: 0 }, { value: "always", weight: 1 }])).toBe("always");
    }
  });

  it.each([[[]], [[{ value: 1, weight: 0 }]], [[{ value: 1, weight: -1 }, { value: 2, weight: 3 }]], [[{ value: 1, weight: Number.NaN }]]])(
    "rejects invalid weights %j",
    (list) => {
      expect(() => createPrng(SEED).weighted(list)).toThrow(RangeError);
    },
  );
});

describe("chance", () => {
  it("is always false at 0 and always true at 1", () => {
    const rng = createPrng(SEED);
    for (let i = 0; i < 500; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("is close to p over many draws and rejects out-of-range values", () => {
    const rng = createPrng(SEED);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (rng.chance(0.18)) hits++;
    expect(hits / 20_000).toBeGreaterThan(0.17);
    expect(hits / 20_000).toBeLessThan(0.19);
    expect(() => rng.chance(1.1)).toThrow(RangeError);
    expect(() => rng.chance(-0.1)).toThrow(RangeError);
  });
});

describe("shuffle", () => {
  it("returns a permutation and leaves the input alone", () => {
    const rng = createPrng(SEED);
    const input = Array.from({ length: 100 }, (_, i) => i);
    const shuffled = rng.shuffle(input);
    expect(input).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
    expect(shuffled).not.toEqual(input);
  });

  it("handles empty and single-item lists", () => {
    expect(createPrng(SEED).shuffle([])).toEqual([]);
    expect(createPrng(SEED).shuffle(["x"])).toEqual(["x"]);
  });
});

describe("fork", () => {
  it("is deterministic per label and differs between labels", () => {
    const a = createPrng(SEED).fork("flat:T12-0408");
    const b = createPrng(SEED).fork("flat:T12-0408");
    const c = createPrng(SEED).fork("flat:T12-0409");
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    expect(createPrng(SEED).fork("x").next()).not.toBe(c.next());
  });

  it("does not depend on how many numbers the parent has already produced", () => {
    const fresh = createPrng(SEED);
    const used = createPrng(SEED);
    for (let i = 0; i < 1000; i++) used.next();
    expect(used.fork("label").next()).toBe(fresh.fork("label").next());
  });

  it("depends on the seed", () => {
    expect(createPrng(1).fork("label").next()).not.toBe(createPrng(2).fork("label").next());
  });
});
