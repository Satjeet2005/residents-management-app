import { describe, expect, it } from "vitest";
import { NO_FILTERS, boardHref, boardQueryString, flatCodePrefix, hasFilters, parseBoardQuery } from "@/lib/staff-complaints/board-query";

describe("D151 the board's query string", () => {
  it("defaults to needs_action with no filters", () => {
    expect(parseBoardQuery({})).toEqual({ view: "needs_action", filters: NO_FILTERS });
  });

  it.each(["needs_action", "mine", "safety", "triage", "open", "overdue", "waiting", "closed"])("?view=%s is accepted", (view) => {
    expect(parseBoardQuery({ view }).view).toBe(view);
  });

  it.each([
    ["needs-triage", "triage"],
    ["safety", "safety"],
    ["open", "open"],
    ["overdue", "overdue"],
    ["waiting", "waiting"],
    ["closed", "closed"],
  ])("the old ?lane=%s is an alias of the %s view", (lane, view) => {
    expect(parseBoardQuery({ lane }).view).toBe(view);
  });

  it("?view wins over ?lane, and the first of a repeated parameter is read", () => {
    expect(parseBoardQuery({ view: "mine", lane: "closed" }).view).toBe("mine");
    expect(parseBoardQuery({ view: ["open", "closed"] }).view).toBe("open");
    expect(parseBoardQuery({ view: "nope", lane: "closed" }).view).toBe("closed");
  });

  it.each(["__proto__", "constructor", "toString", "NEEDS_ACTION", "needs_action ", "", "<script>", "mine,open", "1", "needs-triage"])("a hostile or unknown view %j is ignored", (view) => {
    expect(parseBoardQuery({ view }).view).toBe("needs_action");
  });

  it.each(["__proto__", "constructor", "hasOwnProperty", "NEEDS-TRIAGE", "triage", "all"])("a hostile or unknown lane %j is ignored", (lane) => {
    expect(parseBoardQuery({ lane }).view).toBe("needs_action");
  });

  it("reads the four filters from allowlists and ignores every other value", () => {
    expect(parseBoardQuery({ category: "LIFT", assignee: "me", urgency: "HIGH", q: "t12-04" }).filters).toEqual({ category: "LIFT", assignee: "me", urgency: "HIGH", q: "T12-04" });
    expect(parseBoardQuery({ assignee: "unassigned" }).filters.assignee).toBe("unassigned");
    for (const category of ["lift", "GARDEN", "LIFT'; DROP TABLE complaints;--", "__proto__", "", "FIRE"]) expect(parseBoardQuery({ category }).filters.category, category).toBeNull();
    for (const assignee of ["ME", "someone", "uuid", "", "__proto__"]) expect(parseBoardQuery({ assignee }).filters.assignee, assignee).toBe("anyone");
    for (const urgency of ["high", "URGENT", "", "1", "constructor"]) expect(parseBoardQuery({ urgency }).filters.urgency, urgency).toBeNull();
  });

  it("every urgency and category code is accepted", () => {
    for (const urgency of ["CRITICAL", "HIGH", "NORMAL", "LOW"]) expect(parseBoardQuery({ urgency }).filters.urgency).toBe(urgency);
    for (const category of ["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"]) expect(parseBoardQuery({ category }).filters.category).toBe(category);
  });

  it("round trips: the address built from a query parses back to it", () => {
    const query = parseBoardQuery({ view: "overdue", category: "PLUMBING", assignee: "unassigned", urgency: "LOW", q: "T07 12" });
    expect(parseBoardQuery(Object.fromEntries(new URLSearchParams(boardQueryString(query))))).toEqual(query);
    expect(boardHref({ view: "mine", filters: NO_FILTERS })).toBe("/staff/complaints?view=mine");
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, assignee: "me" })).toBe(true);
  });
});

describe("D151 the flat-code search", () => {
  it.each([
    ["T12-0408", "T12-0408"],
    ["t12-0408", "T12-0408"],
    ["t12 0408", "T12-0408"],
    ["T12/04", "T12-04"],
    ["t12_04", "T12-04"],
    ["t12.04", "T12-04"],
    ["t1204", "T12-04"],
    ["T12", "T12"],
    ["t5", "T05"],
    ["t5 408", "T05-0408"],
    ["  t07-12  ", "T07-12"],
    ["T07", "T07"],
  ])("%j is the prefix %s", (text, prefix) => {
    expect(flatCodePrefix(text)).toBe(prefix);
  });

  it.each(["", "t", "1", "12", "0408", "T", "T12-040812", "T12-0408X", "x12-04", "T12%", "T1__2", "t12--04", "T123-04", "T12'; --", "%%", "tower 12", "T12 04 08", "ＴＩ２"])("%j is ignored (null)", (text) => {
    expect(flatCodePrefix(text)).toBeNull();
  });

  it("a text of 9 or more characters is ignored, and 2 to 8 are read", () => {
    expect(flatCodePrefix("T12-04080")).toBeNull();
    expect(flatCodePrefix("T1")).toBe("T01");
    expect(flatCodePrefix("T12-0408")).toBe("T12-0408");
  });
});
