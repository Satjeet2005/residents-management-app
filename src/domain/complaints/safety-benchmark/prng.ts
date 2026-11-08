/** A small seeded generator of its own (mulberry32), so the benchmark never changes when another module's generator does. */
export type Rng = { next(): number; int(min: number, max: number): number; pick<T>(list: readonly T[]): T; shuffle<T>(list: readonly T[]): T[] };

/** FNV-1a over a label: a stable 32-bit mix of a seed, a kind and an index. */
export function mixSeed(seed: number, label: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)];
  const shuffle = <T>(list: readonly T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { next, int, pick, shuffle };
}

/** The generator for item `index` of the `kind` list of `seed`: items do not depend on each other. */
export const itemRng = (seed: number, kind: string, index: number): Rng => createRng(mixSeed(seed, `${kind}:${index}`));
