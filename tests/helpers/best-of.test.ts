import { describe, expect, it } from "vitest";
import { bestOfMs, bestOfMsAsync } from "./best-of";

/** A clock that returns the given readings in turn, so a test can say how long each call "took". */
function fakeClock(durations: number[]): () => number {
  const readings = durations.flatMap((d, i) => [i * 1000, i * 1000 + d]);
  let next = 0;
  return () => readings[next++];
}

describe("BO1 best-of timing helper", () => {
  it("returns the minimum of the timed runs", () => {
    expect(bestOfMs(() => undefined, 4, fakeClock([300, 120, 900, 150]))).toBe(120);
  });

  it("does not count the warm-up: it runs once more than the timed runs", () => {
    let calls = 0;
    bestOfMs(() => calls++, 5, fakeClock([1, 1, 1, 1, 1]));
    expect(calls).toBe(6);
  });

  it("a function that is slow every time still reports a slow best, so its test still fails", () => {
    const best = bestOfMs(() => undefined, 5, fakeClock([700, 650, 900, 800, 720]));
    expect(best).toBe(650);
    expect(best < 500).toBe(false);
  });

  it("one slow run among fast ones does not change the best", () => {
    expect(bestOfMs(() => undefined, 5, fakeClock([40, 41, 5000, 42, 43]))).toBe(40);
  });

  it("the async form gives the minimum, the result of the last timed call and one untimed warm-up", async () => {
    let calls = 0;
    const { bestMs, result } = await bestOfMsAsync(async () => ++calls, 3, fakeClock([90, 30, 60]));
    expect(bestMs).toBe(30);
    expect(result).toBe(4);
    expect(calls).toBe(4);
  });

  it("a real slow function is measured as slow with the real clock", () => {
    const best = bestOfMs(() => {
      const until = performance.now() + 20;
      while (performance.now() < until);
    }, 2);
    expect(best).toBeGreaterThanOrEqual(19);
  });
});
