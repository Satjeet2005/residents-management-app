import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewComplaintView } from "@/app/(resident)/complaints/new/new-complaint-view";
import { type ComplaintFormState, complaintFormReducer, initialComplaintForm } from "@/lib/complaint-form";

const noop = () => {};
const render = (state: ComplaintFormState, dutyManagerPhone: string | null = "5900000001") => renderToStaticMarkup(h(NewComplaintView, { state, dutyManagerPhone, onBodyChange: noop, onDangerChoose: noop, onSubmit: noop }));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("D127 the form as first shown", () => {
  const html = render(initialComplaintForm);

  it("has one h1, a labelled textarea with a counter of 2,000, and the danger question with Yes and No", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toMatch(/<label for="complaint-body"[^>]*>What is the problem\?<\/label>/);
    expect(html).toMatch(/<textarea[^>]*id="complaint-body"/);
    expect(text(html)).toContain("0 of 2000 characters");
    expect(html).toMatch(/<legend[^>]*>Is anyone in danger right now\?<\/legend>/);
    expect(count(html, /type="radio"/g)).toBe(2);
    expect(html).toMatch(/value="YES"/);
    expect(html).toMatch(/value="NO"/);
  });

  it("D127 NEITHER radio is preselected", () => {
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*\schecked/);
    expect(count(html, /checked=""/g)).toBe(0);
  });

  it("shows no alert block and no error before anything is done", () => {
    expect(html).not.toContain("role=\"alert\"");
    expect(text(html)).not.toContain("call the duty manager now");
  });

  it("has exactly one filled control: Send complaint", () => {
    expect(count(html, /bg-accent/g)).toBe(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*bg-accent[^>]*>Send complaint<\/button>/);
  });

  it("targets are at least 48px, the Yes/No pair has 8px between them, and text is 16px body", () => {
    expect(count(html, /min-h-12/g)).toBeGreaterThanOrEqual(3);
    expect(html).toContain('class="flex gap-2"');
    expect(html).toContain("text-body");
  });

  it("uses no forbidden styling", () => {
    expect(html).not.toMatch(/uppercase|tracking-|italic|shadow/);
  });
});

describe("D121 the danger answer Yes", () => {
  const yes = complaintFormReducer(initialComplaintForm, { type: "DANGER_CHOSEN", value: "YES" });
  const html = render(yes);

  it("shows the alert block at once, with the large tel: link and 'You can still send this report.'", () => {
    expect(text(html)).toContain("If someone is in danger, call the duty manager now.");
    expect(html).toMatch(/<a [^>]*class="[^"]*min-h-14[^"]*"[^>]*href="tel:5900000001"|<a [^>]*href="tel:5900000001"[^>]*>/);
    expect(text(html)).toContain("Call duty manager");
    expect(text(html)).toContain("You can still send this report.");
    expect(html).toContain('role="alert"');
  });

  it("keeps exactly one filled control: the call link, so Send complaint is outlined", () => {
    expect(count(html, /bg-accent/g)).toBe(1);
    expect(html).toMatch(/<a [^>]*bg-accent[^>]*href="tel:/);
    const send = /<button[^>]*type="submit"[^>]*>/.exec(html)?.[0] ?? "";
    expect(send).toContain("border-control");
    expect(send).not.toContain("bg-accent");
  });

  it("marks only Yes as checked", () => {
    expect(count(html, /checked=""/g)).toBe(1);
    expect(html).toMatch(/value="YES"[^>]*checked=""|checked=""[^>]*value="YES"/);
  });

  it("with no duty number set, says so and draws no link to nowhere", () => {
    const none = render(yes, null);
    expect(text(none)).toContain("The duty manager's number is not set");
    expect(none).not.toContain("tel:");
    expect(count(none, /bg-accent/g)).toBe(0);
  });

  it("the answer No shows no alert and Send is filled again", () => {
    const no = render(complaintFormReducer(initialComplaintForm, { type: "DANGER_CHOSEN", value: "NO" }));
    expect(no).not.toContain('role="alert"');
    expect(count(no, /bg-accent/g)).toBe(1);
  });
});

describe("T13b form states", () => {
  const refused = complaintFormReducer(initialComplaintForm, { type: "SUBMIT" });

  it("a refused submit shows both inline errors, linked to their fields", () => {
    const html = render(refused);
    expect(text(html)).toContain("Choose Yes or No.");
    expect(text(html)).toContain("Write what is wrong, so we can help.");
    expect(html).toContain('id="danger-error"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("sending shows a loading label and disables the fields", () => {
    const busy = { ...initialComplaintForm, body: "Leak", danger: "NO" as const, busy: true };
    const html = render(busy);
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*>Sending<\/button>/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });

  it.each([
    ["VALIDATION", "We couldn't send that. Check what you wrote and try again.", "Try again"],
    ["NO_FLAT", "No flat is linked to your account yet.", "Send complaint"],
    ["RATE_LIMITED", "Too many tries in a short time.", "Try again"],
    ["NETWORK", "We couldn't reach the server.", "Try again"],
    ["SERVER", "Something went wrong on our side.", "Try again"],
  ] as const)("the error %s is a plain sentence and the button reads %s", (error, sentence, label) => {
    const html = render({ ...initialComplaintForm, body: "Leak", danger: "NO", submitError: error });
    expect(text(html)).toContain(sentence);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${label}</button>`));
  });
});
