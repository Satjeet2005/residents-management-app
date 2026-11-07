import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGuards } from "@/server/auth/guard";
import { MAX_LOGGED_MESSAGE_CHARS, logRouteError, redact } from "@/server/log";

/** D111: a failed route is logged as one JSON line with a redacted message, and no secret can be in it. */

const PASSWORD = "s3cr3tPassw0rd";
const ENV = {
  DATABASE_URL: `postgresql://township_app:${PASSWORD}@ep-quiet-lake-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`,
  OTP_PEPPER: "pepper-value-for-the-test-0123456789",
  PAYMENT_WEBHOOK_SECRET: "webhook-value-for-the-test-9876543210",
  SESSION_SECRET: "short-session-secret",
  LLM_API_KEY: "sk-test-key",
};
const SECRETS = [PASSWORD, ENV.OTP_PEPPER, ENV.PAYMENT_WEBHOOK_SECRET, ENV.SESSION_SECRET, ENV.LLM_API_KEY];

let lines: string[];
beforeEach(() => {
  lines = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined); // "error event not stored": these routes have no database
});
afterEach(() => vi.restoreAllMocks());

const logged = (error: unknown, route = "/api/auth/otp/request") => {
  lines = [];
  logRouteError(route, error, ENV);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as { msg: string; route: string; errorName: string; code: string | null; message: string };
};

describe("D111 redaction", () => {
  it("removes a postgres:// and a postgresql:// URL, in any letter case", () => {
    expect(redact("cannot reach postgres://u:p@host:5432/db now", {})).toBe("cannot reach [secret] now");
    expect(redact("bad postgresql://u:p@host/db?sslmode=require", {})).toBe("bad [secret]");
    expect(redact("POSTGRESQL://u:p@host/db", {})).toBe("[secret]");
  });

  it("removes a run of 32 or more token characters and keeps a run of 31", () => {
    expect(redact(`key ${"a".repeat(32)} end`, {})).toBe("key [secret] end");
    expect(redact(`key ${"aB3+/=_-".repeat(5)} end`, {})).toBe("key [secret] end");
    expect(redact(`key ${"a".repeat(31)} end`, {})).toBe(`key ${"a".repeat(31)} end`);
  });

  it("removes the exact value of each secret variable that is set, wherever it appears", () => {
    for (const name of ["OTP_PEPPER", "PAYMENT_WEBHOOK_SECRET", "SESSION_SECRET", "LLM_API_KEY"] as const) {
      expect(redact(`before ${ENV[name]} after`, ENV)).toBe("before [secret] after");
    }
    expect(redact(`${ENV.SESSION_SECRET}/${ENV.SESSION_SECRET}`, ENV)).toBe("[secret]/[secret]");
  });

  it("removes the password of DATABASE_URL even when it appears alone, as written or percent-decoded", () => {
    const env = { DATABASE_URL: "postgresql://app:p%40ss%2Fword1@host/db" };
    expect(redact("password p%40ss%2Fword1 and p@ss/word1", env)).toBe("password [secret] and [secret]");
  });

  it("an unset or empty variable replaces nothing (an empty value must not blank the message)", () => {
    expect(redact("plain text", { OTP_PEPPER: "", DATABASE_URL: undefined })).toBe("plain text");
  });

  it("keeps ordinary error text readable", () => {
    expect(redact('relation "otp_codes" does not exist', ENV)).toBe('relation "otp_codes" does not exist');
  });
});

describe("D111 logRouteError", () => {
  it("writes exactly one line of valid JSON with the five fields", () => {
    logRouteError("/api/me", new Error("boom"), ENV);
    expect(lines).toHaveLength(1);
    expect(Object.keys(JSON.parse(lines[0]))).toEqual(["msg", "route", "errorName", "code", "message"]);
    expect(lines[0]).not.toContain("\n");
  });

  it("an error with a Postgres SQLSTATE logs the code and the class name", () => {
    class DatabaseError extends Error {
      code = "42P01";
    }
    expect(logged(new DatabaseError('relation "otp_codes" does not exist'))).toEqual({
      msg: "route failed",
      route: "/api/auth/otp/request",
      errorName: "DatabaseError",
      code: "42P01",
      message: 'relation "otp_codes" does not exist',
    });
  });

  it("a Prisma code (P1001) is logged, and a code found on the cause is used", () => {
    expect(logged(Object.assign(new Error("x"), { code: "P1001" })).code).toBe("P1001");
    expect(logged(new Error("outer", { cause: Object.assign(new Error("inner"), { code: "28P01" }) })).code).toBe("28P01");
  });

  it("an error without a code, or with a code that is not five characters (ECONNREFUSED), logs null", () => {
    expect(logged(new Error("plain")).code).toBeNull();
    expect(logged(Object.assign(new Error("x"), { code: "ECONNREFUSED" })).code).toBeNull();
    expect(logged(Object.assign(new Error("x"), { code: 42501 })).code).toBeNull();
  });

  it("a circular cause chain does not loop", () => {
    const error = new Error("loop") as Error & { cause?: unknown };
    error.cause = error;
    expect(logged(error).code).toBeNull();
  });

  it("the message is cut to 300 characters after redaction", () => {
    const message = logged(new Error("x ".repeat(400))).message;
    expect(message).toHaveLength(MAX_LOGGED_MESSAGE_CHARS);
  });

  it("a secret that straddles the cut is redacted before the cut, so no piece of it is logged", () => {
    const line = `${"x ".repeat(145)}${ENV.OTP_PEPPER} tail`;
    const message = logged(new Error(line)).message;
    expect(message).toContain("[secret]");
    expect(message).not.toContain("pepper-value");
  });

  it("a thrown string is logged redacted; any other thrown value is described by a fixed text and never printed", () => {
    expect(logged(`failed with ${ENV.LLM_API_KEY}`)).toMatchObject({ errorName: "NonError", code: null, message: "failed with [secret]" });
    const object = logged({ code: "42P01", message: "secret detail", password: PASSWORD });
    expect(object).toMatchObject({ errorName: "NonError", code: "42P01", message: "a value that is not an Error was thrown" });
    expect(lines[0]).not.toContain(PASSWORD);
    for (const value of [null, undefined, 42, Symbol("s")]) {
      expect(logged(value)).toMatchObject({ errorName: "NonError", message: "a value that is not an Error was thrown" });
    }
  });

  it("an error whose message getter throws still produces one JSON line", () => {
    const hostile = new Error("x");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("no");
      },
    });
    logRouteError("/api/me", hostile, ENV);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe("route failed");
  });

  it("the route is the path as given, redacted and cut to 100 characters", () => {
    expect(logged(new Error("x"), `/api/${"a".repeat(200)}`).route.length).toBeLessThanOrEqual(100);
    expect(logged(new Error("x"), `/api/${ENV.SESSION_SECRET}`).route).toBe("/api/[secret]");
  });

  const ADVERSARIAL = [
    `connection to ${ENV.DATABASE_URL} failed`,
    `password authentication failed; url=${ENV.DATABASE_URL.toUpperCase()}`,
    `"${ENV.DATABASE_URL}"`,
    `{"url":"${ENV.DATABASE_URL}","retry":true}`,
    `postgres://township_app:${PASSWORD}@ep-quiet-lake-123.ap-southeast-1.aws.neon.tech:5432/neondb`,
    `postgresql://other:${PASSWORD}@ep-quiet-lake-123/neondb`,
    `user=township_app password=${PASSWORD} host=ep-quiet-lake-123.ap-southeast-1.aws.neon.tech`,
    `pepper ${ENV.OTP_PEPPER}`,
    `${ENV.OTP_PEPPER}${ENV.OTP_PEPPER}`,
    `x${ENV.PAYMENT_WEBHOOK_SECRET}x`,
    `hmac(${ENV.PAYMENT_WEBHOOK_SECRET}, body)`,
    `session ${ENV.SESSION_SECRET}\nnext line ${ENV.SESSION_SECRET}`,
    `Authorization: Bearer ${ENV.LLM_API_KEY}`,
    `key=${ENV.LLM_API_KEY}&other=1`,
    `\t${ENV.LLM_API_KEY}\t`,
    `${"x".repeat(280)}${ENV.OTP_PEPPER}`,
    `${"x ".repeat(100)}${ENV.DATABASE_URL}`,
    `token ${"Zz9".repeat(20)}`,
    `${PASSWORD} and ${PASSWORD}`,
    `connect ECONNREFUSED ep-quiet-lake-123.ap-southeast-1.aws.neon.tech:5432 (${ENV.DATABASE_URL})`,
  ];

  it("has 20 adversarial messages", () => expect(ADVERSARIAL).toHaveLength(20));

  it.each(ADVERSARIAL.map((message, index) => [index + 1, message] as const))("adversarial message %i leaves no secret in the line", (_index, message) => {
    for (const thrown of [new Error(message), message]) {
      lines = [];
      logRouteError(`/api/${message.slice(0, 40)}`, thrown, ENV);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
      for (const secret of [...SECRETS, ENV.DATABASE_URL, "Zz9".repeat(20)]) expect(lines[0]).not.toContain(secret);
      expect(lines[0]).not.toMatch(/postgres(ql)?:\/\//i);
    }
  });
});

describe("D111 the guards log a failure and answer generically", () => {
  it("a handler that throws a database error: 500 SERVER_ERROR with a reference and no detail, one log line with the code, and nothing from the request", async () => {
    const PROCESS_URL = `postgresql://app:${PASSWORD}@host.example/db`; // the guard reads the real process.env, so this one is caught by the URL rule
    const guards = createGuards(() => ({ db: {} as never, sender: {} as never, now: () => 0 }));
    const route = guards.publicRoute(() => {
      throw Object.assign(new Error(`connect failed for ${PROCESS_URL}`), { code: "28P01" });
    });
    const request = new Request("http://localhost/api/auth/otp/request?phone=9876543210", {
      method: "POST",
      headers: { cookie: "session=abc", "content-type": "application/json" },
      body: JSON.stringify({ phone: "9876543210", code: "123456" }),
    });
    const response = await route(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "SERVER_ERROR", ref: expect.stringMatching(/^E-[0-9A-Z]{6}$/) });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({ level: "error", source: "ROUTE", route: "/api/auth/otp/request", method: "POST", status: 500, errorName: "Error", code: "28P01" });
    expect(lines[0]).not.toMatch(/9876543210|123456|session=|abc/);
    expect(lines[0]).not.toContain(PASSWORD);
  });
});
