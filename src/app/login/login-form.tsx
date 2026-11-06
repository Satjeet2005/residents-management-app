"use client";

import { useEffect, useReducer, useRef } from "react";
import { classifyRequest, classifyVerify, initialLoginState, loginReducer } from "@/lib/login-state";
import { LoginView } from "./login-view";

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown; retryAfter: string | null }> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json, retryAfter: response.headers.get("retry-after") };
}

/** The login form: talks to POST /api/auth/otp/request and /verify, and goes to the address the server gives after a login. */
export function LoginForm({ returnTo }: { returnTo: string | null }) {
  const [state, dispatch] = useReducer(loginReducer, initialLoginState);
  const codeInput = useRef<HTMLInputElement>(null);

  // After the code is sent, the cursor goes to the code field.
  useEffect(() => {
    if (state.step === "CODE") codeInput.current?.focus();
  }, [state.step]);

  // A wait counts down once a second.
  useEffect(() => {
    if (state.waitSeconds <= 0) return;
    const timer = setTimeout(() => dispatch({ type: "TICK" }), 1000);
    return () => clearTimeout(timer);
  }, [state.waitSeconds]);

  async function send() {
    dispatch({ type: "SEND_STARTED" });
    try {
      const result = await post("/api/auth/otp/request", { phone: state.phone.trim() });
      const outcome = classifyRequest(result.status, result.json, result.retryAfter);
      if (outcome.kind === "SENT") dispatch({ type: "SEND_SUCCEEDED", demoCode: outcome.demoCode, retryAfterSeconds: outcome.retryAfterSeconds });
      else dispatch({ type: "SEND_FAILED", error: outcome.error, retryAfterSeconds: outcome.retryAfterSeconds });
    } catch {
      dispatch({ type: "SEND_FAILED", error: "NETWORK" });
    }
  }

  async function verify() {
    dispatch({ type: "VERIFY_STARTED" });
    try {
      const result = await post("/api/auth/otp/verify", { phone: state.phone.trim(), code: state.code, ...(returnTo === null ? {} : { returnTo }) });
      const outcome = classifyVerify(result.status, result.json, result.retryAfter);
      if (outcome.kind === "OK") {
        dispatch({ type: "VERIFY_SUCCEEDED" });
        window.location.assign(outcome.redirectTo);
      } else {
        dispatch({ type: "VERIFY_FAILED", error: outcome.error, retryAfterSeconds: outcome.retryAfterSeconds });
      }
    } catch {
      dispatch({ type: "VERIFY_FAILED", error: "NETWORK" });
    }
  }

  return (
    <LoginView
      state={state}
      onPhoneChange={(value) => dispatch({ type: "PHONE_CHANGED", value })}
      onCodeChange={(value) => dispatch({ type: "CODE_CHANGED", value })}
      onSend={send}
      onVerify={verify}
      onChangeNumber={() => dispatch({ type: "CHANGE_NUMBER" })}
      codeInputRef={codeInput}
    />
  );
}
