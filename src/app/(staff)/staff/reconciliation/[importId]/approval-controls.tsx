"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { t } from "@/lib/messages";
import { type ApprovalErrorKind, type ApprovalKind, type ApprovalResult, approvalErrorText, approvalNoteValid, approvalResultLines, interpretApprovalResponse, rejectReasonValid } from "@/lib/reconciliation/approval-state";
import { payerNoticeText } from "@/lib/reconciliation/labels";
import { REASON_MAX, reasonCounter, submitErrorText } from "@/lib/reconciliation/review-state";

type Phase = { status: "CLOSED" } | { status: "OPEN"; kind: ApprovalKind } | { status: "SENDING"; kind: ApprovalKind } | { status: "DONE"; result: ApprovalResult } | { status: "FAILED"; kind: ApprovalKind; error: ApprovalErrorKind };

/**
 * Approve (with an optional note) and Reject (with a required reason) for a row that awaits a second approver. Only drawn for someone who
 * holds payments:approve and did not ask; the server refuses anyone else again. The two buttons open a small form, so nothing is decided
 * by one tap, and a request in flight blocks a second one.
 */
export function ApprovalControls({ rowId }: { rowId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ status: "CLOSED" });
  const [text, setText] = useState("");
  const fieldId = useId();
  const kind = phase.status === "OPEN" || phase.status === "SENDING" || phase.status === "FAILED" ? phase.kind : null;
  const sending = phase.status === "SENDING";
  const valid = kind === "REJECT" ? rejectReasonValid(text) : approvalNoteValid(text);

  async function send(which: ApprovalKind) {
    if (sending) return;
    setPhase({ status: "SENDING", kind: which });
    try {
      const response = await fetch(`/api/bank-rows/${rowId}/${which === "APPROVE" ? "approve" : "reject"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(which === "APPROVE" ? (text.trim() === "" ? {} : { note: text.trim() }) : { reason: text.trim() }),
      });
      const answer = interpretApprovalResponse(which, response.status, await response.json().catch(() => null));
      if (answer.ok) {
        setPhase({ status: "DONE", result: answer.result });
        router.refresh();
      } else {
        setPhase({ status: "FAILED", kind: which, error: answer.error });
      }
    } catch {
      setPhase({ status: "FAILED", kind: which, error: "NETWORK" });
    }
  }

  if (phase.status === "DONE") {
    return (
      <div aria-live="polite">
        <Notice>
          <ul className="flex flex-col gap-1">
            {approvalResultLines(phase.result).map((line, index) => (
              <li key={index} className={index === 0 ? "font-semibold" : "tnum"}>
                {line}
              </li>
            ))}
            {phase.result.kind === "APPROVED_MATCH" && phase.result.payerNotice !== null && <li>{payerNoticeText(phase.result.payerNotice)}</li>}
          </ul>
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {kind === null && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outlined" onClick={() => setPhase({ status: "OPEN", kind: "APPROVE" })}>
            {t("recon.approve.button")}
          </Button>
          <Button variant="outlined" onClick={() => setPhase({ status: "OPEN", kind: "REJECT" })}>
            {t("recon.reject.button")}
          </Button>
        </div>
      )}
      {kind !== null && (
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-body font-semibold">
            {kind === "APPROVE" ? t("recon.approve.note") : t("recon.reject.reason")}
          </label>
          <textarea id={fieldId} rows={2} value={text} disabled={sending} onChange={(event) => setText(event.target.value)} className="w-full rounded-control border-2 border-control bg-paper p-3 text-body" />
          <p className="tnum text-caption text-ink-2">{reasonCounter(text)}</p>
          {!valid && text.trim() !== "" && (
            <p role="alert" className="text-body font-semibold text-caution">
              {t("recon.error.reason")}
            </p>
          )}
          <p className="sr-only">{t("recon.panel.reasonMax", { max: REASON_MAX })}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button disabled={!valid} loading={sending} loadingLabel={t("recon.panel.sending")} onClick={() => send(kind)}>
              {kind === "APPROVE" ? t("recon.approve.confirm") : t("recon.reject.confirm")}
            </Button>
            <Button variant="outlined" disabled={sending} onClick={() => setPhase({ status: "CLOSED" })}>
              {t("recon.approval.cancel")}
            </Button>
          </div>
        </div>
      )}
      <div aria-live="polite">
        {phase.status === "FAILED" && (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-control border-2 border-caution p-4">
            <p className="text-body font-semibold text-caution">{approvalErrorText(phase.error, submitErrorText)}</p>
            {phase.error === "CHANGED" && (
              <Button variant="outlined" onClick={() => router.refresh()}>
                {t("recon.panel.reload")}
              </Button>
            )}
            {phase.error === "NETWORK" && (
              <Button variant="outlined" onClick={() => send(phase.kind)}>
                {t("recon.panel.retry")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
