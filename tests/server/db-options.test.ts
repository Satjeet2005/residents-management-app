import { describe, expect, it } from "vitest";
import { DB_POOL_DEFAULT_MAX, dbPoolOptions } from "@/server/db-options";

describe("D91 dbPoolOptions", () => {
  it("defaults: 5 connections, 8 s to connect, 10 s idle, 10 s per query", () => {
    expect(dbPoolOptions({})).toEqual({ max: 5, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, query_timeout: 10000 });
    expect(DB_POOL_DEFAULT_MAX).toBe(5);
  });

  it.each([undefined, "", "   "])("DB_POOL_MAX %j gives the default", (value) => {
    expect(dbPoolOptions({ DB_POOL_MAX: value }).max).toBe(5);
  });

  it.each([["1", 1], ["2", 2], ["10", 10], [" 7 ", 7], ["05", 5]])("DB_POOL_MAX %j gives %i", (value, expected) => {
    expect(dbPoolOptions({ DB_POOL_MAX: value }).max).toBe(expected);
  });

  it.each(["0", "11", "100", "-1", "2.5", "abc", "5x", "1e1", "0x5", "NaN", "Infinity", "1000", "٣"])("DB_POOL_MAX %j throws a RangeError", (value) => {
    expect(() => dbPoolOptions({ DB_POOL_MAX: value })).toThrow(RangeError);
  });

  it("the timeouts do not depend on DB_POOL_MAX", () => {
    const small = dbPoolOptions({ DB_POOL_MAX: "1" });
    const large = dbPoolOptions({ DB_POOL_MAX: "10" });
    expect({ ...small, max: 0 }).toEqual({ ...large, max: 0 });
  });

  it("overrides win, for tests", () => {
    expect(dbPoolOptions({}, { connectionTimeoutMillis: 500, max: 2 })).toMatchObject({ connectionTimeoutMillis: 500, max: 2, idleTimeoutMillis: 10000, query_timeout: 10000 });
  });

  it("every number is positive and the connect timeout is below the function limit and above a cold start", () => {
    const o = dbPoolOptions({});
    for (const value of Object.values(o)) expect(value).toBeGreaterThan(0);
    expect(o.connectionTimeoutMillis).toBeGreaterThan(2000);
    expect(o.connectionTimeoutMillis).toBeLessThan(30000);
  });
});
