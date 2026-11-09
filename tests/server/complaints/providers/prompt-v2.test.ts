import { describe, expect, it } from "vitest";
import { BENCHMARK_ITEMS } from "@/domain/complaints/classifier-benchmark/dataset";
import { CLASSIFIER_PROMPT_VERSION, type PromptVersion, buildRequest } from "@/server/complaints/providers/system-one";

const COMPLAINT = "The tube light in the 2nd floor passage is not working.";
const V1_GOLDEN = '{"state":"The tube light in the 2nd floor passage is not working.","questions":{"category":{"type":"choice","instructions":"Which kind of problem does this complaint from a resident of a housing society describe?","criteria":{"PLUMBING":"Water problems: a leak, a blocked drain, a tap, a pipe, no water, a toilet or bathroom fixture.","ELECTRICAL":"Electrical problems: a light, a fan, a switch, a socket, a power cut, wiring, a meter.","HOUSEKEEPING":"Cleaning and waste: garbage not collected, dirty stairs or corridors, sweeping, pests, gardening.","LIFT":"The lift or elevator: slow, noisy, out of service, a button or door that does not work.","OTHER":"Anything else: noise, parking, security, pets, neighbours, or something that fits none of the above."}},"urgency":{"type":"choice","instructions":"How urgent is this complaint from a resident of a housing society?","criteria":{"HIGH":"Needs action today: a service is fully out, or the problem is getting worse quickly.","NORMAL":"An ordinary problem that should be fixed in the next day or two.","LOW":"A small matter, a suggestion, or something that can wait several days."}}}}';
const V2_GOLDEN = '{"state":"The tube light in the 2nd floor passage is not working.","questions":{"category":{"type":"choice","instructions":"Which kind of problem does this complaint from a resident of a housing society describe? The text may be in English, Hindi, Marathi or a mix.","criteria":{"PLUMBING":"Water problems: a leak, a blocked drain, a tap, a pipe, no water, a toilet or bathroom fixture.","ELECTRICAL":"Electrical problems: a light, a fan, a switch, a socket, a power cut, wiring, a meter.","HOUSEKEEPING":"Cleaning and waste: garbage not collected, dirty stairs or corridors, sweeping, pests, gardening.","LIFT":"The lift or elevator: slow, noisy, out of service, a button or door that does not work.","OTHER":"Anything else: noise, parking, security, pets, neighbours, or something that fits none of the above."}},"urgency":{"type":"choice","instructions":"How urgent is this complaint from a resident of a housing society? The text may be in English, Hindi, Marathi or a mix.","criteria":{"HIGH":"Someone must act TODAY: water entering a home, a whole wing or tower without power or water, a lift out of service, a blocked main drain, or a gate or access failure.","NORMAL":"A routine repair that can be done within a day or two.","LOW":"Cosmetic, convenience, noise, parking or a suggestion."}}}}';

const fixedPart = (version: PromptVersion, question?: "category" | "urgency"): string => {
  const request = buildRequest("", undefined, version);
  return JSON.stringify(question === undefined ? request : { ...request, questions: { [question]: request.questions[question] } });
};

describe("PV8 prompt versions (D197)", () => {
  it("v1 is unchanged: the exact request for a fixed complaint, so the benchmark stays reproducible", () => {
    expect(JSON.stringify(buildRequest(COMPLAINT, undefined, "v1"))).toBe(V1_GOLDEN);
  });

  it("v2 is the exact request for a fixed complaint", () => {
    expect(JSON.stringify(buildRequest(COMPLAINT, undefined, "v2"))).toBe(V2_GOLDEN);
  });

  it("the default version is the constant, and it is v1 until the pre-registered rule adopts v2", () => {
    expect(CLASSIFIER_PROMPT_VERSION).toBe("v1");
    expect(JSON.stringify(buildRequest(COMPLAINT))).toBe(V1_GOLDEN);
  });

  it("size guard: the part that is not the complaint is at most 600 characters longer in v2, for each question", () => {
    for (const question of ["category", "urgency"] as const) {
      expect(fixedPart("v2", question).length - fixedPart("v1", question).length).toBeLessThanOrEqual(600);
    }
    expect(fixedPart("v2").length - fixedPart("v1").length).toBeLessThanOrEqual(600);
  });

  it("no leak: no benchmark complaint, and no part of one, is in either request apart from the complaint itself", () => {
    for (const version of ["v1", "v2"] as const) {
      const fixed = fixedPart(version);
      for (const item of BENCHMARK_ITEMS) expect(fixed).not.toContain(item.text);
    }
  });

  it("CRITICAL is never offered: the label set has HIGH, NORMAL and LOW only, in both versions", () => {
    for (const version of ["v1", "v2"] as const) {
      const request = buildRequest(COMPLAINT, undefined, version);
      expect(Object.keys(request.questions.urgency.criteria)).toEqual(["HIGH", "NORMAL", "LOW"]);
      expect(JSON.stringify(request)).not.toContain("CRITICAL");
    }
  });

  it("the body is only the state and the two questions (and the model when set): no user, no flat", () => {
    expect(Object.keys(buildRequest(COMPLAINT, undefined, "v2"))).toEqual(["state", "questions"]);
    expect(Object.keys(buildRequest(COMPLAINT, "m", "v2"))).toEqual(["model", "state", "questions"]);
  });
});
