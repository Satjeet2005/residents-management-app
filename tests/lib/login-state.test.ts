import { describe, expect, it } from "vitest";
import { classifyRequest, classifyVerify, initialLoginState, loginReducer, type LoginState } from "@/lib/login-state";
import { waitText } from "@/lib/time-text";

const at = (over: Partial<LoginState>): LoginState => ({ ...initialLoginState, ...over });

describe("HM4 login reducer: every transition", () => {
  it("starts on the phone step with nothing typed", () => {
    expect(initialLoginState).toEqual({ step: "PHONE", phone: "", code: "", busy: "NONE", error: null, waitSeconds: 0, demoCode: null });
  });

  it("PHONE_CHANGED keeps what was typed, caps it at 20 characters, and clears a phone error only", () => {
    expect(loginReducer(initialLoginState, { type: "PHONE_CHANGED", value: "98765 43210" }).phone).toBe("98765 43210");
    expect(loginReducer(initialLoginState, { type: "PHONE_CHANGED", value: "9".repeat(30) }).phone).toHaveLength(20);
    expect(loginReducer(at({ error: "INVALID_PHONE" }), { type: "PHONE_CHANGED", value: "9" }).error).toBeNull();
    expect(loginReducer(at({ error: "TOO_MANY", waitSeconds: 9 }), { type: "PHONE_CHANGED", value: "9" }).error).toBe("TOO_MANY");
  });

  it("CODE_CHANGED keeps digits only, at most 6, and clears a 'not accepted' error only", () => {
    expect(loginReducer(initialLoginState, { type: "CODE_CHANGED", value: "12a3 45-6789" }).code).toBe("123456");
    expect(loginReducer(initialLoginState, { type: "CODE_CHANGED", value: "٣٤" }).code).toBe("");
    expect(loginReducer(at({ error: "NOT_ACCEPTED" }), { type: "CODE_CHANGED", value: "1" }).error).toBeNull();
    expect(loginReducer(at({ error: "LOCKED" }), { type: "CODE_CHANGED", value: "1" }).error).toBe("LOCKED");
  });

  it("SEND_STARTED is busy sending and clears the error", () => {
    expect(loginReducer(at({ error: "NETWORK" }), { type: "SEND_STARTED" })).toMatchObject({ busy: "SENDING", error: null });
  });

  it("SEND_SUCCEEDED moves to the code step, empties the code, keeps the demo code and the pause", () => {
    const next = loginReducer(at({ busy: "SENDING", phone: "9876543210", code: "999999" }), { type: "SEND_SUCCEEDED", demoCode: "123456", retryAfterSeconds: 30 });
    expect(next).toMatchObject({ step: "CODE", busy: "NONE", code: "", error: null, demoCode: "123456", waitSeconds: 30, phone: "9876543210" });
    expect(loginReducer(at({}), { type: "SEND_SUCCEEDED", demoCode: null, retryAfterSeconds: 30 }).demoCode).toBeNull();
  });

  it("SEND_FAILED stops the busy state and shows the error; TOO_MANY starts a wait of at least one second", () => {
    expect(loginReducer(at({ busy: "SENDING" }), { type: "SEND_FAILED", error: "INVALID_PHONE" })).toMatchObject({ busy: "NONE", error: "INVALID_PHONE", step: "PHONE" });
    expect(loginReducer(at({ busy: "SENDING" }), { type: "SEND_FAILED", error: "TOO_MANY", retryAfterSeconds: 90 })).toMatchObject({ error: "TOO_MANY", waitSeconds: 90 });
    expect(loginReducer(at({ busy: "SENDING" }), { type: "SEND_FAILED", error: "TOO_MANY" }).waitSeconds).toBe(1);
    expect(loginReducer(at({ busy: "SENDING" }), { type: "SEND_FAILED", error: "TOO_MANY", retryAfterSeconds: 0.2 }).waitSeconds).toBe(1);
    expect(loginReducer(at({ busy: "SENDING" }), { type: "SEND_FAILED", error: "NETWORK" })).toMatchObject({ error: "NETWORK", waitSeconds: 0 });
  });

  it("VERIFY_STARTED is busy verifying and clears the error", () => {
    expect(loginReducer(at({ step: "CODE", error: "NOT_ACCEPTED" }), { type: "VERIFY_STARTED" })).toMatchObject({ busy: "VERIFYING", error: null });
  });

  it("VERIFY_FAILED: a wrong code is emptied, a lock keeps the code, a network error keeps everything", () => {
    const base = at({ step: "CODE", busy: "VERIFYING", code: "123456" });
    expect(loginReducer(base, { type: "VERIFY_FAILED", error: "NOT_ACCEPTED" })).toMatchObject({ busy: "NONE", error: "NOT_ACCEPTED", code: "" });
    expect(loginReducer(base, { type: "VERIFY_FAILED", error: "LOCKED" })).toMatchObject({ error: "LOCKED", code: "123456" });
    expect(loginReducer(base, { type: "VERIFY_FAILED", error: "NETWORK" })).toMatchObject({ error: "NETWORK", code: "123456" });
    expect(loginReducer(base, { type: "VERIFY_FAILED", error: "TOO_MANY", retryAfterSeconds: 45 }).waitSeconds).toBe(45);
  });

  it("VERIFY_SUCCEEDED stays busy (the page is about to change) with no error", () => {
    expect(loginReducer(at({ step: "CODE", busy: "VERIFYING" }), { type: "VERIFY_SUCCEEDED" })).toMatchObject({ busy: "VERIFYING", error: null });
  });

  it("CHANGE_NUMBER goes back to the phone step, keeps the number to edit, forgets the code, the demo code and the pause", () => {
    const next = loginReducer(at({ step: "CODE", phone: "9876543210", code: "123", demoCode: "123456", waitSeconds: 20, error: "NOT_ACCEPTED" }), { type: "CHANGE_NUMBER" });
    expect(next).toEqual({ ...initialLoginState, phone: "9876543210" });
  });

  it("TICK counts a wait down by one, never below zero, and clears 'too many' when it reaches zero", () => {
    expect(loginReducer(at({ waitSeconds: 5, error: "TOO_MANY" }), { type: "TICK" })).toMatchObject({ waitSeconds: 4, error: "TOO_MANY" });
    expect(loginReducer(at({ waitSeconds: 1, error: "TOO_MANY" }), { type: "TICK" })).toMatchObject({ waitSeconds: 0, error: null });
    expect(loginReducer(at({ waitSeconds: 0 }), { type: "TICK" }).waitSeconds).toBe(0);
    expect(loginReducer(at({ waitSeconds: 1, error: "NETWORK" }), { type: "TICK" }).error).toBe("NETWORK");
  });

  it("a whole sequence: phone, send, wrong code, right code", () => {
    let s = initialLoginState;
    s = loginReducer(s, { type: "PHONE_CHANGED", value: "5000000006" });
    s = loginReducer(s, { type: "SEND_STARTED" });
    s = loginReducer(s, { type: "SEND_SUCCEEDED", demoCode: "246810", retryAfterSeconds: 30 });
    s = loginReducer(s, { type: "CODE_CHANGED", value: "000000" });
    s = loginReducer(s, { type: "VERIFY_STARTED" });
    s = loginReducer(s, { type: "VERIFY_FAILED", error: "NOT_ACCEPTED" });
    expect(s).toMatchObject({ step: "CODE", code: "", error: "NOT_ACCEPTED", busy: "NONE" });
    s = loginReducer(s, { type: "CODE_CHANGED", value: "246810" });
    s = loginReducer(s, { type: "VERIFY_STARTED" });
    s = loginReducer(s, { type: "VERIFY_SUCCEEDED" });
    expect(s).toMatchObject({ busy: "VERIFYING", error: null, code: "246810" });
  });
});

describe("HM4 classifyRequest (POST /api/auth/otp/request)", () => {
  it("200 with the generic message is sent, with the demo code when there is one", () => {
    expect(classifyRequest(200, { message: "OTP_SENT_GENERIC", retryAfterSeconds: 30, demoCode: "123456" }, null)).toEqual({ kind: "SENT", demoCode: "123456", retryAfterSeconds: 30 });
    expect(classifyRequest(200, { message: "OTP_SENT_GENERIC", retryAfterSeconds: 30 }, null)).toEqual({ kind: "SENT", demoCode: null, retryAfterSeconds: 30 });
  });
  it("a demo code that is not digits is ignored", () => {
    expect(classifyRequest(200, { message: "OTP_SENT_GENERIC", demoCode: "<script>" }, null)).toMatchObject({ kind: "SENT", demoCode: null });
  });
  it("400 INVALID_PHONE and INVALID_REQUEST are a phone problem", () => {
    expect(classifyRequest(400, { error: "INVALID_PHONE" }, null)).toEqual({ kind: "FAILED", error: "INVALID_PHONE" });
    expect(classifyRequest(400, { error: "INVALID_REQUEST" }, null)).toEqual({ kind: "FAILED", error: "INVALID_PHONE" });
  });
  it("429 uses Retry-After, else the body, else 30 seconds", () => {
    expect(classifyRequest(429, { error: "TOO_MANY_REQUESTS", retryAfterSeconds: 12 }, "75")).toEqual({ kind: "FAILED", error: "TOO_MANY", retryAfterSeconds: 75 });
    expect(classifyRequest(429, { error: "TOO_MANY_REQUESTS", retryAfterSeconds: 12 }, null)).toMatchObject({ retryAfterSeconds: 12 });
    expect(classifyRequest(429, null, "abc")).toMatchObject({ retryAfterSeconds: 30 });
    expect(classifyRequest(429, {}, "0")).toMatchObject({ retryAfterSeconds: 30 });
  });
  it.each([[500, { error: "SERVER_ERROR" }], [403, { error: "CSRF_BLOCKED" }], [404, null], [200, { message: "OTHER" }], [200, null]])("%i %j is a server problem", (status, body) => {
    expect(classifyRequest(status, body, null)).toEqual({ kind: "FAILED", error: "SERVER" });
  });
});

describe("HM4 classifyVerify (POST /api/auth/otp/verify)", () => {
  it("200 with a redirect to a path on this site is a login", () => {
    expect(classifyVerify(200, { role: "RESIDENT", redirectTo: "/" }, null)).toEqual({ kind: "OK", redirectTo: "/" });
    expect(classifyVerify(200, { role: "STAFF", redirectTo: "/staff" }, null)).toEqual({ kind: "OK", redirectTo: "/staff" });
  });
  it("200 with a redirect that is not a path is not trusted", () => {
    expect(classifyVerify(200, { redirectTo: "https://evil.example" }, null)).toEqual({ kind: "FAILED", error: "SERVER" });
    expect(classifyVerify(200, {}, null)).toEqual({ kind: "FAILED", error: "SERVER" });
  });
  it("OTP_NOT_ACCEPTED and a bad body are 'not accepted'; OTP_LOCKED is locked", () => {
    expect(classifyVerify(400, { error: "OTP_NOT_ACCEPTED" }, null)).toEqual({ kind: "FAILED", error: "NOT_ACCEPTED" });
    expect(classifyVerify(400, { error: "INVALID_REQUEST" }, null)).toEqual({ kind: "FAILED", error: "NOT_ACCEPTED" });
    expect(classifyVerify(400, { error: "OTP_LOCKED" }, null)).toEqual({ kind: "FAILED", error: "LOCKED" });
  });
  it("429 and the rest", () => {
    expect(classifyVerify(429, { error: "TOO_MANY_REQUESTS" }, "20")).toEqual({ kind: "FAILED", error: "TOO_MANY", retryAfterSeconds: 20 });
    expect(classifyVerify(500, null, null)).toEqual({ kind: "FAILED", error: "SERVER" });
    expect(classifyVerify(403, { error: "CSRF_BLOCKED" }, null)).toEqual({ kind: "FAILED", error: "SERVER" });
  });
});

describe("HM4 waitText", () => {
  it.each([[1, "1 second"], [2, "2 seconds"], [59, "59 seconds"], [0, "1 second"], [0.2, "1 second"], [60, "1 minute"], [61, "2 minutes"], [300, "5 minutes"], [3445, "58 minutes"], [3600, "60 minutes"]])("%d seconds is %s", (n, text) => {
    expect(waitText(n)).toBe(text);
  });
});
