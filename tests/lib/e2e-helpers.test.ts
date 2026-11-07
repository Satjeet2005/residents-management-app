import { describe, expect, it } from "vitest";
import { waitSeconds } from "../e2e/helpers/auth";

describe("the login wait of the browser helper", () => {
  it.each([
    ["Try again in 25 seconds.", 25],
    ["Try again in 1 second.", 1],
    ["Try again in 1 minute.", 60],
    ["Try again in 2 minutes.", 120],
    ["Something else", null],
    ["Try again in a while", null],
  ])("%s is %s", (text, seconds) => {
    expect(waitSeconds(text)).toBe(seconds);
  });
});
