import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/server/auth/return-url";

describe("V5 safeReturnPath accepts a path on this site", () => {
  it.each([
    "/staff",
    "/staff/payments",
    "/payments?month=2026-10",
    "/bills/2026-10#top",
    "/a/b/c/d",
    "/a%20b",
    "/ünïcode",
    "/x".repeat(99),
  ])("keeps %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });
});

describe("V5 safeReturnPath refuses everything else", () => {
  it.each([
    ["a protocol-relative URL", "//evil.com"],
    ["a protocol-relative URL with a path", "//evil.com/staff"],
    ["a slash then a backslash", "/\\evil.com"],
    ["two backslashes", "\\\\evil.com"],
    ["a full URL", "https://evil.com"],
    ["a full URL with the site name in it", "https://township.example.com@evil.com/"],
    ["http", "http://evil.com/staff"],
    ["an encoded double slash", "/%2f%2fevil.com"],
    ["an encoded double slash in capitals", "/%2F%2Fevil.com"],
    ["an encoded slash and backslash", "/%2f%5cevil.com"],
    ["an encoded backslash first", "/%5cevil.com"],
    ["a double-encoded double slash", "/%252f%252fevil.com"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a javascript URL with a leading slash trick", "/javascript:alert(1)//\r\n"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["CRLF injection", "/staff\r\nSet-Cookie: a=b"],
    ["an encoded CRLF", "/staff%0d%0aSet-Cookie:%20a=b"],
    ["a newline", "/staff\nLocation: https://evil.com"],
    ["a tab between the slashes", "/\t/evil.com"],
    ["an encoded tab between the slashes", "/%09/evil.com"],
    ["a leading space", " //evil.com"],
    ["a leading space before a path", " /staff"],
    ["a trailing newline", "/staff\n"],
    ["a null byte", "/staff\u0000"],
    ["an encoded null byte", "/staff%00"],
    ["a line separator", "/ /evil.com"],
    ["a C1 control", "/\u0085/evil.com"],
    ["a relative path", "staff"],
    ["a dot path", "./staff"],
    ["a dot-dot path", "../staff"],
    ["a bad percent sequence", "/%E0%A4%A"],
    ["a longer-than-200 path", `/${"a".repeat(200)}`],
    ["empty", ""],
    ["only a slash then a backslash char", "/\\"],
  ])("sends %s to /", (_label, input) => {
    expect(safeReturnPath(input)).toBe("/");
  });

  it.each([undefined, null, 5, {}, ["/staff"], true])("sends a non-string (%j) to /", (input) => {
    expect(safeReturnPath(input)).toBe("/");
  });

  it("allows exactly 200 characters and not 201", () => {
    expect(safeReturnPath(`/${"a".repeat(199)}`)).toHaveLength(200);
    expect(safeReturnPath(`/${"a".repeat(200)}`)).toBe("/");
  });
});
