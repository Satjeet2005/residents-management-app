import type { FormEvent } from "react";
import { PhoneIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/notice";
import { COMPLAINT_BODY_MAX } from "@/domain/complaints/body";
import { type ComplaintFormState, type DangerAnswer, type SubmitError, charCount } from "@/lib/complaint-form";
import { t } from "@/lib/messages";
import { telHref } from "@/lib/phone-link";

const FIELD = "w-full rounded-control border-2 border-control bg-paper px-4 py-3 text-body text-ink";

export function submitErrorText(error: SubmitError): string {
  switch (error) {
    case "VALIDATION":
      return t("complaintNew.error.validation");
    case "NO_FLAT":
      return t("complaintNew.error.noFlat");
    case "RATE_LIMITED":
      return t("complaintNew.error.rateLimited");
    case "NETWORK":
      return t("complaintNew.error.network");
    case "SERVER":
      return t("complaintNew.error.server");
  }
}

function DangerOption({ value, label, checked, onChoose }: { value: DangerAnswer; label: string; checked: boolean; onChoose: (value: DangerAnswer) => void }) {
  return (
    <label className={cx("flex min-h-12 flex-1 items-center gap-3 rounded-control border-2 px-4 text-body font-semibold", checked ? "border-ink bg-paper-2" : "border-control")}>
      <input type="radio" name="danger" value={value} checked={checked} onChange={() => onChoose(value)} className="h-6 w-6 accent-accent" />
      {label}
    </label>
  );
}

/** What "Yes" shows at once: call now. Sending the report is still allowed. The call link is the one filled control then. */
function DangerAlert({ dutyManagerPhone }: { dutyManagerPhone: string | null }) {
  const href = telHref(dutyManagerPhone);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-control border-2 border-caution p-4">
      <p className="text-body font-semibold">{t("complaintNew.alert.title")}</p>
      {href === null ? (
        <p className="text-body">{t("complaintNew.alert.noNumber")}</p>
      ) : (
        <ButtonLink href={href} large>
          <PhoneIcon />
          {t("complaintNew.alert.call")}
        </ButtonLink>
      )}
      <p className="text-body">{t("complaintNew.alert.canSend")}</p>
    </div>
  );
}

export type NewComplaintViewProps = {
  state: ComplaintFormState;
  dutyManagerPhone: string | null;
  onBodyChange: (value: string) => void;
  onDangerChoose: (value: DangerAnswer) => void;
  onSubmit: () => void;
};

/**
 * The raise form for one state (D127). The danger question comes after the text, has no preselected answer and is required. Exactly one filled
 * control at any time: "Send complaint", or the call link while the answer is Yes (then Send is outlined).
 */
export function NewComplaintView({ state, dutyManagerPhone, onBodyChange, onDangerChoose, onSubmit }: NewComplaintViewProps) {
  const bodyInvalid = state.fieldErrors.includes("BODY_REQUIRED");
  const dangerInvalid = state.fieldErrors.includes("DANGER_REQUIRED");
  const retry = state.submitError !== null && state.submitError !== "NO_FLAT";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("complaintNew.title")}</h1>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="complaint-body" className="text-body font-semibold">
            {t("complaintNew.body.label")}
          </label>
          <p id="complaint-body-hint" className="text-caption text-ink-2">
            {t("complaintNew.body.hint")}
          </p>
          <textarea
            id="complaint-body"
            name="body"
            rows={6}
            value={state.body}
            onChange={(event) => onBodyChange(event.target.value)}
            aria-describedby={bodyInvalid ? "complaint-body-hint complaint-body-error" : "complaint-body-hint"}
            aria-invalid={bodyInvalid || undefined}
            disabled={state.busy}
            className={FIELD}
          />
          <p className="tnum text-caption text-ink-2">{t("complaintNew.body.count", { n: charCount(state.body), max: COMPLAINT_BODY_MAX })}</p>
          {bodyInvalid && (
            <p id="complaint-body-error" className="text-body font-semibold text-caution">
              {t("complaintNew.body.required")}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2" disabled={state.busy} aria-describedby={dangerInvalid ? "danger-error" : undefined}>
          <legend className="pb-2 text-body font-semibold">{t("complaintNew.danger.legend")}</legend>
          <div className="flex gap-2">
            <DangerOption value="YES" label={t("complaintNew.danger.yes")} checked={state.danger === "YES"} onChoose={onDangerChoose} />
            <DangerOption value="NO" label={t("complaintNew.danger.no")} checked={state.danger === "NO"} onChoose={onDangerChoose} />
          </div>
          {dangerInvalid && (
            <p id="danger-error" className="text-body font-semibold text-caution">
              {t("complaintNew.danger.required")}
            </p>
          )}
        </fieldset>

        {state.danger === "YES" && <DangerAlert dutyManagerPhone={dutyManagerPhone} />}
        {state.submitError !== null && <Notice kind="alert">{submitErrorText(state.submitError)}</Notice>}

        <Button type="submit" variant={state.danger === "YES" ? "outlined" : "primary"} loading={state.busy} loadingLabel={t("complaintNew.sending")}>
          {retry ? t("complaintNew.retry") : t("complaintNew.send")}
        </Button>
      </form>
    </main>
  );
}
