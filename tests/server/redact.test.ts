import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError, digestText, logError, logEvent, newRef, redact, redactStack, requestIdText } from "@/server/log";

/** D135: redaction v2, the structured event line and the reference. Adversarial inputs, then a seeded property test. */

const ENV = {
  DATABASE_URL: "postgresql://township_app:Pw-9x!7@ep-quiet-lake-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  OTP_PEPPER: "pepper-value-for-the-test-0123456789",
  PAYMENT_WEBHOOK_SECRET: "webhook-value-for-the-test-9876543210",
  SESSION_SECRET: "short-session-secret",
  LLM_API_KEY: "sk-test-key",
  LOGS_DATABASE_URL: "postgresql://logs_reader:LogsPw-42@ep-quiet-lake-123.ap-southeast-1.aws.neon.tech/neondb",
  OPS_TEST_TOKEN: "ops-token-for-the-test-aaaaaaaaaaaaaaaaaaaa",
  JEV_PRIMARY_KEY: "jev-primary-key-value",
  JEV_SECONDARY_URL: "https://jev.example.test/api/v1/systemone",
  JEV_SECONDARY_KEY: "jev-secondary-key-value",
};
const EXACT = ["Pw-9x!7", "LogsPw-42", ENV.OTP_PEPPER, ENV.PAYMENT_WEBHOOK_SECRET, ENV.SESSION_SECRET, ENV.LLM_API_KEY, ENV.OPS_TEST_TOKEN, ENV.JEV_PRIMARY_KEY, ENV.JEV_SECONDARY_URL, ENV.JEV_SECONDARY_KEY];

let lines: string[];
beforeEach(() => {
  lines = [];
  const keep = (line: unknown) => void lines.push(String(line));
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());

const circular: Record<string, unknown> = { password: "Pw-9x!7" };
circular.self = circular;

const ADVERSARIAL: [string, string][] = [
  ["credentials in an https URL", "GET https://admin:hunter2@internal.example.test/path failed"],
  ["credentials in an ftp URL without a password", "ftp://deploy@files.example.test/x"],
  ["a token in a query string", "callback https://x.example.test/cb?token=abc123def&next=/home"],
  ["an api_key assignment", `${"api"}_${"key"}=${"AKIA"}1234 rejected`],
  ["a password assignment with quotes", `{"password":"correct horse"}`],
  ["a bearer header", "sent Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig and failed"],
  ["an Authorization header line", "Authorization: Basic dXNlcjpwYXNz\nnext line"],
  ["a lower-case authorization JSON key", `{"authorization":"Token abc"}`],
  ["a phone number", "otp for 9876543210 failed"],
  ["a phone number with the country code", "sms to 919876543210 failed"],
  ["a 16 digit number", "card 4111111111111111 declined"],
  ["Devanagari digits", "फोन ९८७६५४३२१० पर कोड भेजा"],
  ["an e-mail address", "no account for ravi.kumar+test@example.co.in"],
  ["a long hex hash", `hash ${"a1b2c3d4".repeat(8)} mismatch`],
  ["a very long token", `t=${"Zz9_-".repeat(40)}`],
  ["the database URL", `connect failed: ${ENV.DATABASE_URL}`],
  ["the database password alone", "password Pw-9x!7 is wrong"],
  ["the logs database URL", `reading ${ENV.LOGS_DATABASE_URL}`],
  ["the logs database password alone", "role password LogsPw-42"],
  ["the pepper", `pepper ${ENV.OTP_PEPPER} used`],
  ["the webhook secret", `hmac(${ENV.PAYMENT_WEBHOOK_SECRET}, body)`],
  ["the session secret twice", `${ENV.SESSION_SECRET}/${ENV.SESSION_SECRET}`],
  ["the model key", `key ${ENV.LLM_API_KEY}`],
  ["the ops token", `x-ops-token: ${ENV.OPS_TEST_TOKEN}`],
  ["a JEV key", `provider key ${ENV.JEV_PRIMARY_KEY}`],
  ["a JEV URL", `POST ${ENV.JEV_SECONDARY_URL} 401`],
  ["a secret glued to other text", `x${ENV.OTP_PEPPER}x`],
  ["a secret that straddles 500 characters", `${"x ".repeat(247)}${ENV.OTP_PEPPER}`],
  ["unicode and emoji around a secret", `🔥 आग ${ENV.SESSION_SECRET} 🔥`],
  ["a megabyte of text with a secret at the end", `${"ab ".repeat(400_000)}${ENV.LLM_API_KEY}`],
  ["control characters", `\u0000\u0007${ENV.LLM_API_KEY}\r\n\t`],
  ["a stack-like text with a secret", `Error: x\n    at connect (${ENV.OTP_PEPPER}:1:1)`],
  ["only digits", "1".repeat(100)],
  ["an empty string", ""],
];

describe("D135 redact: adversarial inputs", () => {
  it("has at least 30 adversarial inputs", () => expect(ADVERSARIAL.length).toBeGreaterThanOrEqual(30));

  it.each(ADVERSARIAL)("%s: nothing sensitive survives, and it never throws", (_name, input) => {
    const out = redact(input, ENV);
    for (const secret of EXACT) expect(out).not.toContain(secret);
    expect(out).not.toMatch(/[0-9]{10,}/);
    expect(out).not.toMatch(/\p{Nd}{10,}/u);
    expect(out).not.toMatch(/[A-Za-z0-9+/=_-]{32,}/);
    expect(out).not.toMatch(/hunter2|dXNlcjpwYXNz|correct horse|eyJhbGci|ravi\.kumar|abc123def|AKIA1234/);
  });

  it("each adversarial input as an Error message and as a thrown string gives one valid JSON line with no secret", () => {
    for (const [, input] of ADVERSARIAL) {
      for (const thrown of [new Error(input), input]) {
        lines = [];
        logError(thrown, { source: "ROUTE", route: `/api/${input.slice(0, 40)}` }, ENV);
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]) as { message: string };
        expect(parsed.message.length).toBeLessThanOrEqual(500);
        for (const secret of EXACT) expect(lines[0]).not.toContain(secret);
      }
    }
  });

  it("each secret is also removed from the stack of an error", () => {
    for (const secret of EXACT) {
      const error = new Error("x");
      error.stack = `Error: x\n    at run (${secret}:1:1)\n    at other (file.ts:2:2)`;
      const { stack } = describeError(error, ENV);
      expect(stack).not.toContain(secret);
      expect(stack).toContain("[secret]");
    }
  });

  it("non-Error throws are described without being printed: a string, null, undefined, a number, a symbol, a circular object", () => {
    expect(describeError("plain text", ENV)).toMatchObject({ errorName: "NonError", message: "plain text" });
    for (const value of [null, undefined, 42, Symbol("s"), circular, () => 1, 10n]) {
      expect(describeError(value, ENV)).toMatchObject({ errorName: "NonError", message: "a value that is not an Error was thrown", stack: null });
    }
    logError(circular, { source: "ACTION", route: "/x" }, ENV);
    expect(lines[0]).not.toContain("Pw-9x!7");
  });

  it("an unset or empty secret variable replaces nothing", () => {
    expect(redact("plain text", { OTP_PEPPER: "", DATABASE_URL: undefined, OPS_TEST_TOKEN: "" })).toBe("plain text");
  });

  it("keeps ordinary error text readable", () => {
    expect(redact('relation "otp_codes" does not exist', ENV)).toBe('relation "otp_codes" does not exist');
    expect(redact("duplicate key value violates unique constraint", ENV)).toBe("duplicate key value violates unique constraint");
  });
});

describe("D135 limits", () => {
  it("a message is cut to 500 characters after redaction", () => {
    expect(describeError(new Error("x ".repeat(1000)), ENV).message).toHaveLength(500);
  });

  it("a stack keeps the top 12 frames and at most 4,000 characters, and drops the message line", () => {
    const error = new Error("boom");
    error.stack = `Error: boom\n${Array.from({ length: 40 }, (_, i) => `    at frame${i} (file.ts:${i}:1)`).join("\n")}`;
    const { stack, firstFrame } = describeError(error, ENV);
    expect(stack?.split("\n")).toHaveLength(12);
    expect(stack).not.toContain("boom");
    expect(firstFrame).toBe("at frame0 (file.ts:0:1)");
    error.stack = `Error: x\n    at ${"f".repeat(30)} (${"a/".repeat(2500)}file.ts:1:1)`;
    expect(describeError(error, ENV).stack?.length).toBeLessThanOrEqual(4000);
  });

  it("a message getter that throws still gives a description", () => {
    const hostile = new Error("x");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("no");
      },
    });
    expect(describeError(hostile, ENV).message).toBe("the error could not be described");
  });
});

describe("D135 digest", () => {
  it("a plain digest of 10 digits is kept (it is the key a person quotes), in the line and by digestText", () => {
    expect(digestText("3175611538", ENV)).toBe("3175611538");
    expect(digestText("abc123XYZ", ENV)).toBe("abc123XYZ");
    logEvent({ level: "error", source: "PAGE", msg: "x", digest: "3175611538" }, ENV);
    expect(JSON.parse(lines[0]).digest).toBe("3175611538");
  });

  it("anything that is not plainly a digest is redacted, and so is a digest equal to a secret", () => {
    expect(digestText("a@b.com", ENV)).toBe("[secret]");
    expect(digestText("9876543210 and more", ENV)).toBe("[secret] and more");
    expect(digestText("x".repeat(80), ENV)).toBe("[secret]");
    expect(digestText(ENV.LLM_API_KEY.replace(/[^A-Za-z0-9]/g, ""), { LLM_API_KEY: ENV.LLM_API_KEY.replace(/[^A-Za-z0-9]/g, "") })).toBe("[secret]");
  });
});

describe("D135 stacks keep their file paths", () => {
  const PATH_LINE = "at classify (/var/task/src/server/complaints/providers/classifier-jev.ts:55:12)";

  it("a long file path in a frame is not a token: redactStack keeps it, while redact (strict) does not", () => {
    expect(redactStack(PATH_LINE, ENV)).toBe(PATH_LINE);
    expect(redact(PATH_LINE, ENV)).toContain("[secret]");
  });

  it("describeError keeps the path in the stack, and the stdout line too", () => {
    const error = new Error("x");
    error.stack = `Error: x\n    ${PATH_LINE}`;
    expect(describeError(error, ENV).stack).toBe(PATH_LINE);
    logError(error, { source: "ROUTE", route: "/x" }, ENV);
    expect(JSON.parse(lines[0]).stack).toBe(PATH_LINE);
  });

  it("a key, a hash and every exact secret in a frame are still removed", () => {
    const frame = `at run (${"a1b2c3d4".repeat(8)}:1:1) at x (${ENV.OTP_PEPPER}) at y (/srv/${ENV.JEV_PRIMARY_KEY}/z.ts:1:1) at w (${"Zz9_-".repeat(10)})`;
    const out = redactStack(frame, ENV);
    expect(out).not.toMatch(/[A-Za-z0-9+=_-]{32,}/);
    expect(out).not.toContain(ENV.OTP_PEPPER);
    expect(out).not.toContain(ENV.JEV_PRIMARY_KEY);
  });

  it("a phone number, an e-mail address and a bearer value in a frame are removed too", () => {
    expect(redactStack("at f (/a/9876543210/b.ts) Bearer abc.def mail a@b.com", ENV)).not.toMatch(/9876543210|abc\.def|a@b\.com/);
  });
});

describe("D135 request ids", () => {
  const VERCEL = "iad1::sfo1::wqh7h-1730000000000-0123456789ab";

  it("a host request id keeps its digits and hyphens (the host's own log search takes it), in the line and by requestIdText", () => {
    expect(requestIdText(VERCEL, ENV)).toBe(VERCEL);
    logEvent({ level: "error", source: "ROUTE", msg: "x", requestId: VERCEL }, ENV);
    expect(JSON.parse(lines[0]).requestId).toBe(VERCEL);
  });

  it("anything that does not have exactly that shape is redacted like any text", () => {
    for (const value of ["9876543210123", "a@b.com", "x".repeat(40), `${VERCEL} 9876543210`, ENV.LLM_API_KEY, "iad1::wqh7h-12-0123456789ab"]) {
      expect(requestIdText(value, ENV)).not.toBe(value);
    }
  });
});

describe("D135 logEvent and logError", () => {
  it("logEvent writes ONE line of JSON: warn to console.warn, error to console.error", () => {
    logEvent({ level: "warn", source: "PROVIDER", msg: "breaker opened", route: "/api/complaints" }, ENV);
    expect(JSON.parse(lines[0])).toEqual({ level: "warn", source: "PROVIDER", msg: "breaker opened", route: "/api/complaints" });
    expect(console.warn).toHaveBeenCalledTimes(1);
    logEvent({ level: "error", source: "JOB", msg: "failed" }, ENV);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toContain("\n");
  });

  it("logEvent redacts every text field, cuts them, and adds the first 7 characters of the commit", () => {
    logEvent({ level: "error", source: "ROUTE", msg: `m ${ENV.LLM_API_KEY}`, route: `/${ENV.SESSION_SECRET}`, message: "x".repeat(900) + " 9876543210", digest: "d".repeat(300) }, { ...ENV, VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" });
    const line = JSON.parse(lines[0]) as Record<string, string>;
    expect(line.msg).toBe("m [secret]");
    expect(line.route).toBe("/[secret]");
    expect(line.message.length).toBeLessThanOrEqual(500);
    expect(line.digest.length).toBeLessThanOrEqual(100);
    expect(line.deployment).toBe("0123456");
  });

  it("logEvent never throws, even when console.error does", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("stdout closed");
    });
    expect(() => logEvent({ level: "error", source: "JOB", msg: "x" }, ENV)).not.toThrow();
  });

  it("logError returns the reference that is in the line, uses a given reference, and records the code and name", () => {
    class DatabaseError extends Error {
      code = "23505";
    }
    const ref = logError(new DatabaseError("duplicate"), { source: "ROUTE", route: "/api/x", method: "POST", status: 500 }, ENV);
    expect(JSON.parse(lines[0])).toMatchObject({ level: "error", source: "ROUTE", ref, errorName: "DatabaseError", code: "23505", message: "duplicate", method: "POST", status: 500 });
    expect(logError(new Error("x"), { source: "PAGE", ref: "E-ABCDEF" }, ENV)).toBe("E-ABCDEF");
  });

  it("a reference is E- and 6 characters of an alphabet without I, L, O and U, and 2,000 of them do not repeat", () => {
    const refs = new Set(Array.from({ length: 2000 }, newRef));
    expect(refs.size).toBe(2000);
    for (const ref of refs) expect(ref).toMatch(/^E-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
});

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("D135 property: 2,000 seeded random strings", () => {
  const PIECES = ["a", "Z", "7", "0", "-", "_", "+", "/", "=", " ", "@", ".", ":", "Bearer ", "token=", "९", "é", "[", "]", "\n", ENV.OTP_PEPPER, "postgres://u:p@h/d", "Authorization: x", "a@b.co"];

  it("no run of 32 or more token characters or 10 or more digits survives, and the secrets never do", () => {
    const random = seeded(135);
    for (let n = 0; n < 2000; n++) {
      const length = 1 + Math.floor(random() * 120);
      let text = "";
      for (let i = 0; i < length; i++) text += PIECES[Math.floor(random() * PIECES.length)];
      const out = redact(text, ENV);
      expect(out, `seed 135, case ${n}`).not.toMatch(/[A-Za-z0-9+/=_-]{32,}/);
      expect(out, `seed 135, case ${n}`).not.toMatch(/\p{Nd}{10,}/u);
      expect(out, `seed 135, case ${n}`).not.toContain(ENV.OTP_PEPPER);
    }
  });
});
