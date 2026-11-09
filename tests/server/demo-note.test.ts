import { describe, expect, it } from "vitest";
import { demoNoteState } from "@/server/demo-note";

describe("D230 demoNoteState decides which wording the demo note has", () => {
  it("is null outside demo mode, even when DEMO_AS_OF is set", () => {
    expect(demoNoteState({})).toBeNull();
    expect(demoNoteState({ DEMO_MODE: "false", DEMO_AS_OF: "2026-10-27" })).toBeNull();
  });

  it("is the unfrozen wording in demo mode with no DEMO_AS_OF", () => {
    expect(demoNoteState({ DEMO_MODE: "true" })).toEqual({ frozenOn: null });
    expect(demoNoteState({ DEMO_MODE: "true", DEMO_AS_OF: "  " })).toEqual({ frozenOn: null });
  });

  it("is the frozen wording with the date in the app's long format when demo mode and DEMO_AS_OF are both set", () => {
    expect(demoNoteState({ DEMO_MODE: "true", DEMO_AS_OF: "2026-10-27" })).toEqual({ frozenOn: "27 October 2026" });
    expect(demoNoteState({ DEMO_MODE: "true", DEMO_AS_OF: "2027-01-05" })).toEqual({ frozenOn: "5 January 2027" });
  });
});
