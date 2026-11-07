import { describe, expect, it } from "vitest";
import { type Classifier, NullClassifier, classifyWithin } from "@/server/complaints/classifier";
import { canonicalJson, outputHash } from "@/server/complaints/output-hash";
import { arm } from "../integration/complaints-helpers";

describe("CL2 outputHash", () => {
  it("CL2 is the SHA-256 hex of the canonical JSON, whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: "x" }] })).toBe('{"a":[{"c":"x","d":null}],"b":1}');
    expect(outputHash({ a: 1, b: 2 })).toBe(outputHash({ b: 2, a: 1 }));
    expect(outputHash({ a: 1 })).not.toBe(outputHash({ a: 2 }));
    expect(outputHash({})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("CL2 classifyWithin", () => {
  const input = { text: "tap leaks", arm: "DIRECT" } as const;
  it("CL2 returns the answer in time, and null for a throw, a rejection, no answer or a slow answer (which aborts the signal)", async () => {
    expect(await classifyWithin({ classify: async () => arm("PLUMBING") }, input, 100)).toMatchObject({ arm: "DIRECT" });
    expect(await classifyWithin(NullClassifier, input, 100)).toBeNull();
    expect(await classifyWithin({ classify: () => { throw new Error("x"); } } as unknown as Classifier, input, 100)).toBeNull();
    expect(await classifyWithin({ classify: () => Promise.reject(new Error("x")) }, input, 100)).toBeNull();
    let aborted = false;
    const slow: Classifier = { classify: (_i, o) => new Promise((resolve) => { o?.signal?.addEventListener("abort", () => { aborted = true; }); setTimeout(() => resolve(arm("PLUMBING")), 300); }) };
    const started = performance.now();
    expect(await classifyWithin(slow, input, 40)).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
    expect(aborted).toBe(true);
  });
});
