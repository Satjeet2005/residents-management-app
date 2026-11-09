/**
 * Whole-percent shares of `parts` that add to exactly 100 (the largest-remainder method): each part gets the whole percent below its share, and the percents still
 * missing go, one each, to the parts with the largest remainders (a tie goes to the earlier part). Nothing owed gives all zeros. Money stays in integers (bigint).
 */
export function sharesOf(parts: readonly bigint[]): number[] {
  const total = parts.reduce((sum, part) => sum + part, 0n);
  if (total === 0n) return parts.map(() => 0);
  const floors = parts.map((part) => (part * 100n) / total);
  const remainders = parts.map((part, index) => ({ index, rest: (part * 100n) % total }));
  const missing = 100 - Number(floors.reduce((sum, floor) => sum + floor, 0n));
  const winners = new Set([...remainders].sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest < b.rest ? 1 : -1)).slice(0, missing).map((r) => r.index));
  return floors.map((floor, index) => Number(floor) + (winners.has(index) ? 1 : 0));
}
