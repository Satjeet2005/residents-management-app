import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/notice";
import { type ActionError, type ActionState, reasonCount } from "@/lib/complaint-actions";
import { t } from "@/lib/messages";

const FIELD = "w-full rounded-control border-2 border-control bg-paper px-4 py-3 text-body text-ink";

export function actionErrorText(error: ActionError): string {
  switch (error) {
    case "STALE":
      return t("complaintActions.error.stale");
    case "VALIDATION":
      return t("complaintActions.error.validation");
    case "NOT_FOUND":
      return t("complaintActions.error.notFound");
    case "NETWORK":
      return t("complaintActions.error.network");
    case "SERVER":
      return t("complaintActions.error.server");
  }
}

export type ActionsViewProps = {
  state: ActionState;
  /** A safety complaint: only the duty manager confirms it, so there is no "Yes, it's fixed" and no auto-close line (D39). */
  safety: boolean;
  /** The complaint is waiting for the resident's answer (PENDING_CONFIRMATION). */
  pending: boolean;
  autoCloseDays: number;
  onFixed: () => void;
  onProblem: () => void;
  onBack: () => void;
  onRating: (value: number) => void;
  onReason: (value: string) => void;
  onSend: () => void;
  onReload: () => void;
};

function Rating({ state, onRating }: Pick<ActionsViewProps, "state" | "onRating">) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={state.busy}>
      <legend className="pb-2 text-body font-semibold">{t("complaintActions.rate.legend")}</legend>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={state.rating === n}
            aria-label={t("complaintActions.rate.option", { n })}
            onClick={() => onRating(n)}
            className={cx("tnum min-h-12 min-w-12 rounded-control border-2 px-3 text-body font-semibold", state.rating === n ? "border-ink bg-paper-2" : "border-control bg-paper")}
          >
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Reason({ state, onReason }: Pick<ActionsViewProps, "state" | "onReason">) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="reopen-reason" className="text-body font-semibold">
        {t("complaintActions.reason.label")}
      </label>
      <p id="reopen-reason-hint" className="text-caption text-ink-2">
        {t("complaintActions.reason.hint")}
      </p>
      <textarea
        id="reopen-reason"
        rows={4}
        value={state.reason}
        onChange={(event) => onReason(event.target.value)}
        aria-describedby={state.reasonInvalid ? "reopen-reason-hint reopen-reason-error" : "reopen-reason-hint"}
        aria-invalid={state.reasonInvalid || undefined}
        disabled={state.busy}
        className={FIELD}
      />
      <p className="tnum text-caption text-ink-2">{t("complaintActions.reason.count", { n: reasonCount(state.reason) })}</p>
      {state.reasonInvalid && (
        <p id="reopen-reason-error" className="text-body font-semibold text-caution">
          {t("complaintActions.reason.invalid")}
        </p>
      )}
    </div>
  );
}

/**
 * "Is it fixed?" for one state (design 4a and 4b). Both first answers are outlined buttons of equal weight; the filled control appears only
 * on the second step (Done, or Send). A safety complaint has "Still a problem" alone and never an auto-close line.
 */
export function ActionsView(props: ActionsViewProps) {
  const { state, safety, pending, autoCloseDays } = props;
  if (state.done !== null) {
    return (
      <p role="status" className="text-body font-semibold">
        {state.done === "CONFIRMED" ? t("complaintActions.thanksFixed") : t("complaintActions.thanksReopened")}
      </p>
    );
  }
  const failed = state.error !== null && state.error !== "STALE" && state.error !== "NOT_FOUND";
  const error =
    state.error === null ? null : (
      <div className="flex flex-col items-start gap-2">
        <Notice kind="alert">{actionErrorText(state.error)}</Notice>
        {state.error === "STALE" && (
          <Button variant="outlined" onClick={props.onReload}>
            {t("complaintActions.reload")}
          </Button>
        )}
      </div>
    );

  if (state.mode === "ASK") {
    if (safety) {
      return (
        <div className="flex flex-col gap-3">
          {pending && <p className="text-body">{t("complaintActions.dutyConfirms")}</p>}
          <Button variant="outlined" onClick={props.onProblem}>
            {t("complaintActions.stillProblem")}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body font-semibold">{t("complaintActions.question")}</p>
        <div className="flex gap-2">
          <Button variant="outlined" onClick={props.onFixed}>
            {t("complaintActions.fixed")}
          </Button>
          <Button variant="outlined" onClick={props.onProblem}>
            {t("complaintActions.problem")}
          </Button>
        </div>
        <p className="text-body">{t("complaintActions.autoClose", { days: autoCloseDays })}</p>
      </div>
    );
  }

  const reopening = state.mode === "REASON";
  const send = reopening ? t("complaintActions.send") : t("complaintActions.done");
  return (
    <div className="flex flex-col gap-4">
      {reopening ? <Reason state={state} onReason={props.onReason} /> : <Rating state={state} onRating={props.onRating} />}
      {error}
      <div className="flex gap-2">
        <Button loading={state.busy} loadingLabel={t("complaintActions.sending")} onClick={props.onSend}>
          {failed ? t("complaintActions.retry") : send}
        </Button>
        <Button variant="link" disabled={state.busy} onClick={props.onBack}>
          {t("complaintActions.back")}
        </Button>
      </div>
    </div>
  );
}
