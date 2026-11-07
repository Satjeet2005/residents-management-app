import { describe, expect, it } from "vitest";
import { DEFAULT_SAFETY_ACK_TIMEOUT_MINUTES, safetyAlertState } from "@/domain/complaints/safety-alert";

const T0 = Date.UTC(2026, 10, 6, 6, 30);
const MIN = 60_000;
const state = (now: number, firstResponseAt: number | null = null, timeoutMinutes = 5) => safetyAlertState({ createdAt: T0, firstResponseAt, now, timeoutMinutes });

describe("D126 the safety alert state", () => {
  it("the default timeout is 5 minutes", () => {
    expect(DEFAULT_SAFETY_ACK_TIMEOUT_MINUTES).toBe(5);
  });

  it("is SENT from the moment of raising until the timeout passes", () => {
    expect(state(T0)).toBe("SENT");
    expect(state(T0 + 4 * MIN + 59_999)).toBe("SENT");
  });

  it("is NO_ANSWER at exactly the timeout and after, when nobody acknowledged", () => {
    expect(state(T0 + 5 * MIN)).toBe("NO_ANSWER");
    expect(state(T0 + 60 * MIN)).toBe("NO_ANSWER");
  });

  it("is SEEN as soon as there is an acknowledgement, before and after the timeout (a late acknowledgement wins)", () => {
    expect(state(T0 + MIN, T0 + MIN)).toBe("SEEN");
    expect(state(T0 + 30 * MIN, T0 + 20 * MIN)).toBe("SEEN");
  });

  it("uses the timeout it is given", () => {
    expect(state(T0 + 9 * MIN, null, 10)).toBe("SENT");
    expect(state(T0 + 10 * MIN, null, 10)).toBe("NO_ANSWER");
  });
});
