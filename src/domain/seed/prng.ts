/** A weighted choice: `weight` is relative, not a probability. */
export type Weighted<T> = { value: T; weight: number };

export type Prng = {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  weighted<T>(list: readonly Weighted<T>[]): T;
  /** True with probability p (0 to 1). */
  chance(probability: number): boolean;
  /** A new array in random order; the input is not changed. */
  shuffle<T>(list: readonly T[]): T[];
  /**
   * A new generator for `label`, derived from the original seed and the label only.
   * It does not depend on how many numbers this generator has produced, so one
   * flat's draws never change because another flat drew more or fewer.
   */
  fork(label: string): Prng;
};

/** FNV-1a over the label, started from the seed: a small, stable 32-bit mix. */
function deriveSeed(seed: number, label: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** mulberry32: a 32-bit generator with a single number of state. Deterministic, not cryptographic. */
export function createPrng(seed: number): Prng {
  if (!Number.isInteger(seed)) throw new RangeError(`Seed must be an integer, got ${seed}`);
  const initial = seed >>> 0;
  let state = initial;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`int() needs integers with min <= max, got ${min}, ${max}`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(list: readonly T[]): T => {
    if (list.length === 0) throw new RangeError("pick() needs a non-empty list");
    return list[int(0, list.length - 1)];
  };

  const weighted = <T>(list: readonly Weighted<T>[]): T => {
    const total = list.reduce((sum, item) => sum + item.weight, 0);
    if (list.some((item) => !(item.weight >= 0)) || !(total > 0)) {
      throw new RangeError("weighted() needs non-negative weights with a positive total");
    }
    let target = next() * total;
    for (const item of list) {
      if (target < item.weight) return item.value;
      target -= item.weight;
    }
    return list[list.length - 1].value;
  };

  const chance = (probability: number): boolean => {
    if (!(probability >= 0 && probability <= 1)) throw new RangeError(`chance() needs 0 to 1, got ${probability}`);
    return next() < probability;
  };

  const shuffle = <T>(list: readonly T[]): T[] => {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i--) {
      const j = int(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  const fork = (label: string): Prng => createPrng(deriveSeed(initial, label));

  return { next, int, pick, weighted, chance, shuffle, fork };
}
