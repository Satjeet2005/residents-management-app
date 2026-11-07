import { describe, expect, it } from "vitest";
import { NOTHING_FOUND, buildQuery, formatLine, formatPaste, parseLogsArgs, readErrorEvents, render, type ErrorRow, type Queryable } from "@/server/error-reader";

/** D135: the pure part of `npm run logs:errors`. The real database and the process are in tests/integration/logs-cli.test.ts. */

const ROW: ErrorRow = {
  ref: "E-ABC234",
  occurred_at: new Date("2026-11-07T10:20:30.123Z"),
  level: "ERROR",
  source: "ROUTE",
  route: "/api/payments",
  method: "POST",
  status: 500,
  error_name: "Error",
  error_code: "42P01",
  message: "relation does not exist",
  stack: "at run (/app/pay.ts:1:1)\nat next (/app/x.ts:2:2)",
  deployment: "abcdef0",
  digest: "3175611538",
  request_id: "req-1",
  suppressed_count: 0,
};

describe("D135 parseLogsArgs", () => {
  it("defaults: 24h, 20 rows, one line per event", () => {
    expect(parseLogsArgs([])).toEqual({ ok: true, mode: "lines", filters: expect.objectContaining({ since: "24h", limit: 20 }) });
  });

  it("reads every option", () => {
    const parsed = parseLogsArgs(["--since=7d", "--ref=E-AAAAAA", "--digest=12", "--request-id=r", "--route=/api", "--level=warn", "--source=provider", "--limit=200", "--paste"]);
    expect(parsed).toEqual({ ok: true, mode: "paste", filters: { since: "7d", ref: "E-AAAAAA", digest: "12", requestId: "r", route: "/api", level: "WARN", source: "PROVIDER", limit: 200 } });
  });

  it.each([["--since=2h"], ["--since="], ["--limit=0"], ["--limit=201"], ["--limit=abc"], ["--level=info"], ["--source=cron"], ["--password=x"], ["--json", "--paste"], ["--ref=a", "--ref=b"], ["ref=a"], ["--limit"]])("refuses %j with a plain sentence", (...args) => {
    const parsed = parseLogsArgs(args);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.message.length).toBeGreaterThan(10);
  });

  it.each(["30m", "1h", "24h", "7d"])("accepts --since=%s", (since) => {
    expect(parseLogsArgs([`--since=${since}`]).ok).toBe(true);
  });
});

describe("D135 buildQuery", () => {
  const now = Date.UTC(2026, 10, 7, 12);

  it("binds every filter as a parameter and never puts a value in the text", () => {
    const parsed = parseLogsArgs(["--ref=E-X'; DROP TABLE error_events;--", "--route=%_", "--level=error", "--limit=5"]);
    if (!parsed.ok) throw new Error("parse");
    const { text, values } = buildQuery(parsed.filters, now);
    expect(text).not.toMatch(/DROP|E-X|%_/);
    expect(text).toContain("ORDER BY occurred_at DESC LIMIT $5");
    expect(values).toEqual([new Date(now - 86_400_000), "E-X'; DROP TABLE error_events;--", "%_", "ERROR", 5]);
  });

  it("the route is a contains match, not a LIKE pattern", () => {
    const parsed = parseLogsArgs(["--route=/api"]);
    if (!parsed.ok) throw new Error("parse");
    expect(buildQuery(parsed.filters, now).text).toContain("position(lower($2) in lower(route)) > 0");
  });

  it("the time window follows --since", () => {
    for (const [since, ms] of [["30m", 1_800_000], ["1h", 3_600_000], ["24h", 86_400_000], ["7d", 604_800_000]] as const) {
      expect(buildQuery({ since, limit: 1 }, now).values[0]).toEqual(new Date(now - ms));
    }
  });
});

describe("D135 output", () => {
  it("--paste prints one plain-text block per event with the twelve fields and the digest", () => {
    const block = formatPaste(ROW);
    for (const field of ["ref: E-ABC234", "time: 2026-11-07T10:20:30.123Z", "level: ERROR", "source: ROUTE", "route: /api/payments", "method: POST", "status: 500", "error name: Error", "error code: 42P01", "message: relation does not exist", "stack:\nat run", "deployment: abcdef0", "digest: 3175611538"]) {
      expect(block).toContain(field);
    }
    expect(render([ROW, { ...ROW, ref: "E-ABC235" }], "paste").split("\n\n---\n\n")).toHaveLength(2);
  });

  it("everything is redacted again, even if a row holds a secret, a phone number, an e-mail address or a token", () => {
    const dirty = { ...ROW, message: "phone 9876543210 mail a@b.com Bearer abc.def.ghi", stack: `at x (${"k".repeat(40)}:1:1)`, route: "/api?token=abc123", request_id: "9876543210123" };
    for (const text of [formatPaste(dirty), formatLine(dirty), render([dirty], "json"), render([dirty], "paste")]) {
      expect(text).not.toMatch(/9876543210|a@b\.com|abc\.def|k{32}|abc123/);
    }
  });

  it("a plain digest of 10 digits survives the second redaction, in paste and in JSON", () => {
    expect(formatPaste(ROW)).toContain("digest: 3175611538");
    expect(JSON.parse(render([ROW], "json"))[0].digest).toBe("3175611538");
  });

  it("--json is valid JSON, and an empty result is [] in JSON and a plain sentence otherwise", () => {
    expect(JSON.parse(render([ROW], "json"))).toHaveLength(1);
    expect(render([], "json")).toBe("[]");
    expect(render([], "paste")).toBe(NOTHING_FOUND);
    expect(render([], "lines")).toBe(NOTHING_FOUND);
  });

  it("the line has the time, level, source, reference, status, route and message", () => {
    expect(formatLine(ROW)).toBe("2026-11-07T10:20:30.123Z  ERROR  ROUTE     E-ABC234  500  /api/payments  Error: relation does not exist");
  });

  it("a suppressed count is shown when there is one", () => {
    expect(formatPaste({ ...ROW, suppressed_count: 4 })).toContain("suppressed before this: 4");
  });
});

describe("D135 readErrorEvents", () => {
  it("opens a READ ONLY transaction, runs the one SELECT inside it, and ends it, even when the SELECT fails", async () => {
    const seen: string[] = [];
    const client: Queryable = {
      query: async (text) => {
        seen.push(text.split(" ").slice(0, 2).join(" "));
        return { rows: [ROW] };
      },
    };
    expect(await readErrorEvents(client, { since: "24h", limit: 5 }, 0)).toEqual([ROW]);
    expect(seen).toEqual(["BEGIN READ", "SELECT ref,", "COMMIT"]);
    const failing: Queryable = {
      query: async (text) => {
        seen.push(text.slice(0, 6));
        if (text.startsWith("SELECT")) throw new Error("denied");
        return { rows: [] };
      },
    };
    seen.length = 0;
    await expect(readErrorEvents(failing, { since: "24h", limit: 5 }, 0)).rejects.toThrow("denied");
    expect(seen).toEqual(["BEGIN ", "SELECT", "COMMIT"]);
  });
});
