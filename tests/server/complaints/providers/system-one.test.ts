import { describe, expect, it } from "vitest";
import { buildRequest, parseResponse } from "@/server/complaints/providers/system-one";
import docsRequest from "../../../fixtures/system-one/docs-choice-request.json";
import docsResponse from "../../../fixtures/system-one/docs-choice-response.json";
import complaintResponse from "../../../fixtures/system-one/complaint-response.json";

type Body = Record<string, unknown>;
const clone = (value: unknown): Body => JSON.parse(JSON.stringify(value)) as Body;
const answer = (body: Body, name: "category" | "urgency"): Body => (body.answers as Record<string, Body>)[name];
const set = (body: Body, name: "category" | "urgency", change: (a: Body) => void): Body => {
  const copy = clone(body);
  change(answer(copy, name));
  return copy;
};

describe("PV2 request shape", () => {
  const request = buildRequest("water is leaking under the sink", "jev-latest");

  it("has the model, the state and exactly two choice questions, the same top-level fields as the documented request", () => {
    expect(Object.keys(request).sort()).toEqual(Object.keys(docsRequest).filter((k) => k !== "_source").sort());
    expect(Object.keys(request.questions)).toEqual(["category", "urgency"]);
    expect(request.questions.category.type).toBe("choice");
    expect(request.questions.urgency.type).toBe("choice");
    expect(Object.keys(docsRequest.questions.tone).sort()).toEqual(Object.keys(request.questions.category).sort());
  });

  it("offers exactly the five categories and the three urgencies, each with a plain instruction, and no CRITICAL", () => {
    expect(Object.keys(request.questions.category.criteria)).toEqual(["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"]);
    expect(Object.keys(request.questions.urgency.criteria)).toEqual(["HIGH", "NORMAL", "LOW"]);
    expect(JSON.stringify(request)).not.toContain("CRITICAL");
    for (const question of [request.questions.category, request.questions.urgency]) {
      expect(question.instructions.length).toBeGreaterThan(10);
      for (const text of Object.values(question.criteria)) expect(text.length).toBeGreaterThan(10);
    }
  });

  it("carries only the text and the model: the body is exactly those fields", () => {
    expect(request.state).toBe("water is leaking under the sink");
    expect(request.model).toBe("jev-latest");
    expect(Object.keys(request).sort()).toEqual(["model", "questions", "state"]);
  });
});

describe("PV2 fixtures from the docs", () => {
  it("a documented-shape response with this app's labels parses to both distributions in the allowed order", () => {
    const parsed = parseResponse(complaintResponse);
    expect(parsed?.categories.map((c) => c.label)).toEqual(["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"]);
    expect(parsed?.categories[0]).toEqual({ label: "PLUMBING", probability: 0.86 });
    expect(parsed?.urgencies).toEqual([
      { label: "HIGH", probability: 0.2 },
      { label: "NORMAL", probability: 0.7 },
      { label: "LOW", probability: 0.1 },
    ]);
  });

  it("the documented example (other question names and labels) is not a classifier answer", () => {
    expect(parseResponse(docsResponse)).toBeNull();
  });
});

describe("PV3 response validation", () => {
  it("accepts the valid fixture", () => expect(parseResponse(complaintResponse)).not.toBeNull());

  it.each([
    ["not an object", null],
    ["a string", "text"],
    ["an array", []],
    ["no answers", {}],
    ["answers is a list", { answers: [] }],
  ])("%s gives null", (_name, body) => expect(parseResponse(body)).toBeNull());

  it("a missing question gives null", () => {
    const body = clone(complaintResponse);
    delete (body.answers as Body).urgency;
    expect(parseResponse(body)).toBeNull();
  });

  it("a wrong answer type gives null", () => {
    expect(parseResponse(set(complaintResponse, "category", (a) => (a.type = "noul")))).toBeNull();
  });

  it("an unknown label gives null", () => {
    expect(parseResponse(set(complaintResponse, "category", (a) => ((a.probabilities as Body).GARDEN = (a.probabilities as Body).OTHER)))).toBeNull();
    expect(parseResponse(set(complaintResponse, "category", (a) => ((a.probabilities as Body) = { PLUMBING: 0.5, ELECTRICAL: 0.2, HOUSEKEEPING: 0.1, LIFT: 0.1, GARDEN: 0.1 })))).toBeNull();
  });

  it("a missing label gives null", () => {
    expect(parseResponse(set(complaintResponse, "urgency", (a) => (a.probabilities = { HIGH: 0.5, NORMAL: 0.5 })))).toBeNull();
  });

  it("CRITICAL as an urgency gives null, whether it replaces a label or is added", () => {
    expect(parseResponse(set(complaintResponse, "urgency", (a) => (a.probabilities = { CRITICAL: 0.9, NORMAL: 0.05, LOW: 0.05 })))).toBeNull();
    expect(parseResponse(set(complaintResponse, "urgency", (a) => ((a.probabilities as Body).CRITICAL = 0)))).toBeNull();
  });

  it("a chosen label of CRITICAL or an unknown one gives null", () => {
    expect(parseResponse(set(complaintResponse, "urgency", (a) => (a.choice = "CRITICAL")))).toBeNull();
    expect(parseResponse(set(complaintResponse, "category", (a) => (a.choice = 7)))).toBeNull();
  });

  it.each([
    ["NaN as a string", "NaN"],
    ["null", null],
    ["a number as text", "0.5"],
    ["negative", -0.1],
    ["above 1", 1.2],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["not a number", Number.NaN],
  ])("a probability that is %s gives null", (_name, value) => {
    expect(parseResponse(set(complaintResponse, "category", (a) => ((a.probabilities as Body).PLUMBING = value)))).toBeNull();
  });

  it("a sum that is not 1 gives null, and is never renormalised", () => {
    expect(parseResponse(set(complaintResponse, "category", (a) => (a.probabilities = { PLUMBING: 0.5, ELECTRICAL: 0.1, HOUSEKEEPING: 0.1, LIFT: 0.1, OTHER: 0.1 })))).toBeNull();
    expect(parseResponse(set(complaintResponse, "urgency", (a) => (a.probabilities = { HIGH: 0.9, NORMAL: 0.9, LOW: 0.9 })))).toBeNull();
  });

  it("a sum within 0.001 of 1 is accepted", () => {
    expect(parseResponse(set(complaintResponse, "urgency", (a) => (a.probabilities = { HIGH: 0.2, NORMAL: 0.7005, LOW: 0.1 })))).not.toBeNull();
  });

  it("probabilities that are not an object give null", () => {
    expect(parseResponse(set(complaintResponse, "category", (a) => (a.probabilities = [0.2, 0.2, 0.2, 0.2, 0.2])))).toBeNull();
  });
});
