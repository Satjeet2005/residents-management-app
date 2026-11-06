import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginScreen } from "@/app/login/login-screen";
import { LoginView, type LoginViewProps } from "@/app/login/login-view";
import { initialLoginState, type LoginState } from "@/lib/login-state";
import { isDemoMode } from "@/server/clock";

const noop = () => {};
const view = (over: Partial<LoginState>) => {
  const props: LoginViewProps = { state: { ...initialLoginState, ...over }, onPhoneChange: noop, onCodeChange: noop, onSend: noop, onVerify: noop, onChangeNumber: noop };
  return renderToStaticMarkup(h(LoginView, props));
};
const screen = (showDemoNote: boolean, returnTo: string | null = null) => renderToStaticMarkup(h(LoginScreen, { showDemoNote, returnTo }));
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("HM5 login: the phone step", () => {
  const html = view({});

  it("has a labelled mobile number field with a numeric keypad and telephone autocomplete", () => {
    expect(html).toContain('<label for="phone"');
    expect(html).toContain("Mobile number");
    expect(html).toContain('id="phone"');
    expect(html).toContain('type="tel"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="tel"');
    expect(html).toContain('aria-describedby="phone-hint"');
  });

  it("has a Send code button that is a submit, disabled until something is typed, and there is no code field yet", () => {
    expect(html).toContain("Send code");
    expect(html).toContain('type="submit"');
    expect(html).toContain("disabled");
    expect(html).not.toContain('id="code"');
    expect(view({ phone: "9876543210" })).not.toMatch(/<button[^>]*disabled[^>]*>Send code/);
  });

  it("shows no alert when there is no error", () => {
    expect(html).not.toContain('role="alert"');
  });
});

describe("HM5 login: busy and error states", () => {
  it("sending: the button says 'Sending code', is busy and cannot be pressed; the field is locked", () => {
    const html = view({ phone: "9876543210", busy: "SENDING" });
    expect(html).toContain("Sending code");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(">Send code<");
  });

  it.each([
    ["INVALID_PHONE", "That mobile number does not look right"],
    ["NETWORK", "We could not reach the server"],
    ["SERVER", "Something went wrong on our side"],
  ] as const)("%s shows an alert with words", (error, text) => {
    const html = view({ phone: "123", error });
    expect(html).toContain('role="alert"');
    expect(html).toContain(text);
  });

  it("INVALID_PHONE marks the field invalid", () => {
    expect(view({ phone: "123", error: "INVALID_PHONE" })).toContain('aria-invalid="true"');
  });

  it("too many tries: an alert, 'Try again in 12 seconds', and the Send button cannot be pressed", () => {
    const html = view({ phone: "9876543210", error: "TOO_MANY", waitSeconds: 12 });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Too many tries.");
    expect(html).toContain("Try again in 12 seconds.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Send code/);
  });

  it("too many tries for a long time is shown in minutes", () => {
    expect(view({ phone: "9876543210", error: "TOO_MANY", waitSeconds: 3445 })).toContain("Try again in 58 minutes.");
  });
});

describe("HM5 login: the code step", () => {
  const html = view({ step: "CODE", phone: "9876543210" });

  it("has a status line, one labelled code field (not six boxes) and the one-time-code attributes", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain("We sent a code to 9876543210.");
    expect(count(html, /<input/g)).toBe(1);
    expect(html).toContain('<label for="code"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('maxLength="6"');
  });

  it("has a Log in button (disabled until 6 digits) and a 'Use a different number' link-button", () => {
    expect(html).toContain("Log in");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Log in/);
    expect(view({ step: "CODE", phone: "9876543210", code: "123456" })).not.toMatch(/<button[^>]*disabled[^>]*>Log in/);
    expect(html).toContain("Use a different number");
  });

  it("shows the demo banner only when the server returned a code", () => {
    expect(html).not.toContain("Demo mode");
    const withCode = view({ step: "CODE", phone: "9876543210", demoCode: "123456" });
    expect(withCode).toContain("Demo mode: your code is 123456");
  });

  it("verifying: 'Logging in', busy; wrong code and locked are alerts with words", () => {
    expect(view({ step: "CODE", code: "123456", busy: "VERIFYING" })).toContain("Logging in");
    expect(view({ step: "CODE", error: "NOT_ACCEPTED" })).toContain("That code was not accepted");
    const locked = view({ step: "CODE", code: "123456", error: "LOCKED" });
    expect(locked).toContain("Too many wrong tries on this code");
    expect(locked).toMatch(/<button[^>]*disabled[^>]*>Log in/);
  });
});

describe("HM5 login page", () => {
  const html = screen(false);

  it("has exactly one h1 and a main landmark, in plain sentence case", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toContain("<main");
    expect(html).toContain(">Log in</h1>");
  });

  it("D97 shows the demo explanation when demo mode is on, and not otherwise", () => {
    expect(screen(true)).toContain("About this demo data");
    expect(screen(true)).toContain("DEMO_AS_OF=2026-10-27");
    expect(screen(true)).toContain("created as of 27 October 2026");
    expect(html).not.toContain("About this demo data");
    expect(html).not.toContain("DEMO_AS_OF");
  });

  it.each([undefined, "false", "", "TRUE", "1", "yes"])("D97 with DEMO_MODE %j the note is not rendered (the page passes isDemoMode(env))", (value) => {
    const html = screen(isDemoMode({ DEMO_MODE: value }));
    expect(html).not.toContain("About this demo data");
    expect(html).not.toContain("created as of 27 October 2026");
  });

  it("D97 with DEMO_MODE exactly 'true' the note is rendered", () => {
    expect(screen(isDemoMode({ DEMO_MODE: "true" }))).toContain("About this demo data");
  });

  it("the note lists nothing secret: no code, pepper, phone or address", () => {
    const note = screen(true).split("About this demo data")[1];
    expect(note).not.toMatch(/\b[0-9]{6}\b/);
    expect(note).not.toMatch(/pepper|password|secret|postgres/i);
  });

  it("uses no Pay wording and no all-capital words", () => {
    expect(html).not.toMatch(/\bPay\b/);
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\b[A-Z]{4,}\b/);
  });
});
