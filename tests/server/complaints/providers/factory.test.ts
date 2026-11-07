import { describe, expect, it } from "vitest";
import { NullClassifier } from "@/server/complaints/classifier";
import { JevClassifier } from "@/server/complaints/providers/classifier-jev";
import { createClassifierFromEnv, productionClassifier } from "@/server/complaints/providers/factory";

const ONE = { JEV_SECONDARY_URL: "https://example.invalid/api/v1/systemone", JEV_SECONDARY_MODEL: "jev-latest", JEV_SECONDARY_KEY: "test-key-not-a-secret-123" };

describe("createClassifierFromEnv", () => {
  it("no provider configured: the NullClassifier", () => {
    expect(createClassifierFromEnv({})).toBe(NullClassifier);
  });

  it("a partly configured provider is not enough", () => {
    expect(createClassifierFromEnv({ JEV_PRIMARY_URL: "https://example.invalid/x", JEV_PRIMARY_MODEL: "m" })).toBe(NullClassifier);
  });

  it("at least one provider configured: a JevClassifier", () => {
    expect(createClassifierFromEnv(ONE)).toBeInstanceOf(JevClassifier);
  });

  it("an invalid setting never throws: a bad number falls back to its default, a bad provider is skipped", () => {
    expect(createClassifierFromEnv({ ...ONE, JEV_TIMEOUT_MS: "9000" }, { warn: () => undefined })).toBeInstanceOf(JevClassifier);
    expect(createClassifierFromEnv({ ...ONE, JEV_SECONDARY_URL: "http://example.invalid/x" }, { warn: () => undefined })).toBe(NullClassifier);
  });

  it("each call builds its own breakers", () => {
    expect(createClassifierFromEnv(ONE)).not.toBe(createClassifierFromEnv(ONE));
  });
});

describe("productionClassifier", () => {
  it("is built once and kept, so the breaker and the daily count live as long as the instance", () => {
    expect(productionClassifier()).toBe(productionClassifier());
  });

  it("with no provider variables in the environment it never answers (the keyword fallback runs)", async () => {
    expect(await productionClassifier().classify({ text: "a leak", arm: "DIRECT" })).toBeNull();
  });
});
