import { describe, expect, it } from "vitest";
import { BOARD_VIEWS } from "@/domain/complaints/board-views";
import { emptyViewText, safetyAlertText, viewLabel, viewSentence } from "@/lib/staff-complaints/views";

describe("D151 the words of the views", () => {
  it("the eight views are named in the order of the sheet", () => {
    expect(BOARD_VIEWS.map(viewLabel)).toEqual(["Needs action", "Mine", "Safety", "Needs triage", "Open", "Overdue", "Waiting for resident", "Closed"]);
  });

  it("each view has ONE plain sentence: it ends with a full stop and has no second sentence", () => {
    for (const view of BOARD_VIEWS) {
      const sentence = viewSentence(view);
      expect(sentence, view).toMatch(/\.$/);
      expect(sentence.slice(0, -1), view).not.toMatch(/[.!?]/);
    }
  });

  it("the alert strip says how many safety complaints wait, and is absent for none", () => {
    expect(safetyAlertText(0)).toBeNull();
    expect(safetyAlertText(1)).toBe("1 safety complaint waiting for the duty manager.");
    expect(safetyAlertText(4)).toBe("4 safety complaints waiting for the duty manager.");
  });

  it("an empty page says everything is handled, or that nothing matches the filters", () => {
    expect(emptyViewText(false)).toBe("Nothing here. Every complaint is handled.");
    expect(emptyViewText(true)).toBe("No complaint matches these filters.");
  });
});
