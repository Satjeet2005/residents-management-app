import type { FormEvent, Ref } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { type LoginError, type LoginState, CODE_LENGTH, PHONE_MAX_LENGTH } from "@/lib/login-state";
import { t } from "@/lib/messages";
import { waitText } from "@/lib/time-text";

const INPUT = "min-h-12 w-full rounded-control border-2 border-control bg-paper px-4 text-body text-ink";

export type LoginViewProps = {
  state: LoginState;
  onPhoneChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
  onVerify: () => void;
  onChangeNumber: () => void;
  codeInputRef?: Ref<HTMLInputElement>;
};

function errorText(error: LoginError): string {
  switch (error) {
    case "INVALID_PHONE":
      return t("login.error.invalidPhone");
    case "TOO_MANY":
      return t("login.error.tooMany");
    case "NOT_ACCEPTED":
      return t("login.error.notAccepted");
    case "LOCKED":
      return t("login.error.locked");
    case "NETWORK":
      return t("login.error.network");
    case "SERVER":
      return t("login.error.server");
  }
}

const submit = (action: () => void) => (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  action();
};

/** The login form for one state. It holds no logic: every change goes out through a callback (see src/lib/login-state.ts). */
export function LoginView({ state, onPhoneChange, onCodeChange, onSend, onVerify, onChangeNumber, codeInputRef }: LoginViewProps) {
  const alert =
    state.error === null ? null : (
      <Notice kind="alert">
        <span>{errorText(state.error)}</span>
      </Notice>
    );
  const wait = state.waitSeconds > 0 && state.error === "TOO_MANY" ? <p className="tnum text-body">{t("login.wait", { time: waitText(state.waitSeconds) })}</p> : null;

  if (state.step === "PHONE") {
    const waiting = state.error === "TOO_MANY" && state.waitSeconds > 0;
    return (
      <form onSubmit={submit(onSend)} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="phone" className="text-body font-semibold">
            {t("login.phone.label")}
          </label>
          <p id="phone-hint" className="text-caption text-ink-2">
            {t("login.phone.hint")}
          </p>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={PHONE_MAX_LENGTH}
            value={state.phone}
            onChange={(event) => onPhoneChange(event.target.value)}
            aria-describedby="phone-hint"
            aria-invalid={state.error === "INVALID_PHONE" || undefined}
            disabled={state.busy !== "NONE"}
            className={INPUT}
          />
        </div>
        {alert}
        {wait}
        <Button type="submit" loading={state.busy === "SENDING"} loadingLabel={t("login.sending")} disabled={state.phone.trim() === "" || waiting}>
          {t("login.send")}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice kind="status">{t("login.sent", { phone: state.phone.trim() })}</Notice>
      {state.demoCode !== null && (
        <Notice kind="status">
          <strong className="tnum font-semibold">{t("login.demo.banner", { code: state.demoCode })}</strong>
        </Notice>
      )}
      <form onSubmit={submit(onVerify)} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-body font-semibold">
            {t("login.code.label")}
          </label>
          <p id="code-hint" className="text-caption text-ink-2">
            {t("login.code.hint")}
          </p>
          <input
            ref={codeInputRef}
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            value={state.code}
            onChange={(event) => onCodeChange(event.target.value)}
            aria-describedby="code-hint"
            aria-invalid={state.error === "NOT_ACCEPTED" || undefined}
            disabled={state.busy !== "NONE"}
            className={INPUT}
          />
        </div>
        {alert}
        {wait}
        <Button type="submit" loading={state.busy === "VERIFYING"} loadingLabel={t("login.verifying")} disabled={state.code.length < CODE_LENGTH || state.error === "LOCKED"}>
          {t("login.verify")}
        </Button>
      </form>
      <Button variant="link" onClick={onChangeNumber} disabled={state.busy !== "NONE"}>
        {t("login.change")}
      </Button>
    </div>
  );
}
