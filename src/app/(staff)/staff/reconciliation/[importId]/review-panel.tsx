"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { t } from "@/lib/messages";
import { payerNoticeText, thresholdNotice } from "@/lib/reconciliation/labels";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import {
  REASON_MAX,
  type SubmitKind,
  canIgnore,
  canPost,
  initialReviewState,
  interpretManualResponse,
  needsSecondApprover,
  postLabel,
  reasonCounter,
  reasonValid,
  resultLines,
  reviewReducer,
  searchReady,
  submitErrorText,
} from "@/lib/reconciliation/review-state";
import type { FlatHit, Lane, ReviewData } from "@/lib/reconciliation/types";
import { CandidateOption, HitOption } from "./flat-options";
import { ReviewFacts } from "./review-facts";

export const MAIN_ID = "recon-main";
export const rowLinkId = (rowId: string): string => `recon-row-${rowId}`;

/**
 * The review panel of one row. From 1024px it is a panel docked at the right; below that it is a full-screen sheet and the page behind
 * is inert. Focus goes to its heading on open and back to the row on close; Escape closes it. Staff choose a flat (a candidate or a search
 * result), write a reason of at least 5 characters, and post, or say the payment is not for maintenance. Nothing is preselected, nothing is
 * posted in bulk, and a submit in flight blocks a second one. Every decision is sent to the same routes the API has, with the row's version.
 */
export function ReviewPanel({ review, importId, lane, nextRowId, actionsAllowed }: { review: ReviewData; importId: string; lane: Lane; nextRowId: string | null; actionsAllowed: boolean }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reviewReducer, null, () => initialReviewState(null));
  const heading = useRef<HTMLHeadingElement>(null);
  const groupName = useId();
  const reasonId = useId();
  const searchId = useId();
  const credit = BigInt(review.creditPaise);
  const waiting = review.state === "QUEUED";
  const busy = state.submit.status === "SUBMITTING";
  const finished = state.submit.status === "DONE";

  const closeHref = workspaceHref({ importId, lane });

  function close(): void {
    const main = document.getElementById(MAIN_ID);
    if (main !== null) main.inert = false;
    document.getElementById(rowLinkId(review.id))?.focus();
    router.replace(closeHref, { scroll: false });
  }

  useEffect(() => {
    heading.current?.focus();
    const main = document.getElementById(MAIN_ID);
    const wide = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      if (main !== null) main.inert = !wide.matches;
    };
    sync();
    wide.addEventListener("change", sync);
    return () => {
      wide.removeEventListener("change", sync);
      if (main !== null) main.inert = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close() only reads props that are fixed for this panel (it is keyed by row), so one listener per busy change is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  useEffect(() => {
    if (!searchReady(state.query)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      dispatch({ type: "SEARCH_START" });
      try {
        const response = await fetch(`/api/flats/search?q=${encodeURIComponent(state.query.trim())}`, { signal: controller.signal });
        const body = (await response.json()) as { flats?: FlatHit[] };
        if (!response.ok || !Array.isArray(body.flats)) return dispatch({ type: "SEARCH_FAILED" });
        dispatch({ type: "SEARCH_DONE", hits: body.flats });
      } catch {
        if (!controller.signal.aborted) dispatch({ type: "SEARCH_FAILED" });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.query]);

  async function submit(kind: SubmitKind): Promise<void> {
    if (busy) return;
    if (kind === "IGNORE" && !reasonValid(state.reason)) return dispatch({ type: "ASK_REASON" });
    if (kind === "MATCH" && !canPost(state)) return;
    dispatch({ type: "SUBMIT_START", kind });
    const reason = state.reason.trim();
    const chosen = review.candidates.find((c) => c.flatCode === state.flatCode);
    const expectedAmountDuePaise = chosen?.openPositions[0]?.amountDuePaise;
    const body =
      kind === "MATCH"
        ? { flatCode: state.flatCode, reason, rememberPayer: state.remember && review.upiId !== null, expectedVersion: review.version, ...(expectedAmountDuePaise === undefined ? {} : { expectedAmountDuePaise }) }
        : { reason, expectedVersion: review.version };
    try {
      const response = await fetch(`/api/bank-rows/${review.id}/${kind === "MATCH" ? "match" : "ignore"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const answer = interpretManualResponse(kind, response.status, await response.json().catch(() => null));
      if (answer.ok) {
        dispatch({ type: "SUBMIT_DONE", result: answer.result });
        router.refresh();
      } else {
        dispatch({ type: "SUBMIT_FAILED", error: answer.error });
      }
    } catch {
      dispatch({ type: "SUBMIT_FAILED", error: "NETWORK" });
    }
  }

  function next(): void {
    const main = document.getElementById(MAIN_ID);
    if (main !== null) main.inert = false;
    router.replace(workspaceHref({ importId, lane, row: nextRowId }), { scroll: false });
    router.refresh();
  }

  const showHits = searchReady(state.query);
  const result = state.submit.result;
  const lastKind = state.submit.kind;

  return (
    <aside aria-labelledby="recon-panel-title" className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-paper lg:left-auto lg:w-[28rem] lg:border-l-2 lg:border-ink">
      <div className="flex items-center justify-between gap-4 border-b border-hairline p-4">
        <h2 id="recon-panel-title" ref={heading} tabIndex={-1} className="text-title font-semibold">
          {t("recon.panel.title")}
        </h2>
        <Button variant="outlined" onClick={close} disabled={busy}>
          {t("recon.panel.close")}
        </Button>
      </div>
      <div className="flex flex-col gap-6 p-4">
        <ReviewFacts review={review} />

        {!actionsAllowed && <Notice kind="alert">{t("recon.panel.noActions")}</Notice>}
        {actionsAllowed && !waiting && !finished && <Notice>{t("recon.panel.notWaiting")}</Notice>}

        {actionsAllowed && waiting && !finished && (
          <>
            <fieldset className="flex flex-col gap-2" disabled={busy}>
              <legend className="mb-2 text-title font-semibold">{t("recon.panel.candidates")}</legend>
              {review.candidates.length === 0 ? (
                <p className="text-body">{t("recon.panel.noCandidates")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {review.candidates.map((candidate) => (
                    <CandidateOption key={candidate.flatCode} candidate={candidate} creditPaise={credit} name={groupName} selected={state.flatCode} disabled={busy} onChoose={(flatCode) => dispatch({ type: "SELECT_FLAT", flatCode })} />
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor={searchId} className="text-body font-semibold">
                  {t("recon.search.label")}
                </label>
                <input id={searchId} type="search" value={state.query} onChange={(event) => dispatch({ type: "SET_QUERY", query: event.target.value })} aria-describedby={`${searchId}-hint`} className="min-h-12 w-full rounded-control border-2 border-control bg-paper px-3 text-body" />
                <p id={`${searchId}-hint`} className="text-caption text-ink-2">
                  {t("recon.search.hint")}
                </p>
                <div aria-live="polite" className="text-body">
                  {showHits && state.search.status === "LOADING" && <p>{t("recon.search.loading")}</p>}
                  {showHits && state.search.status === "ERROR" && <p className="font-semibold text-caution">{t("recon.search.error")}</p>}
                  {showHits && state.search.status === "DONE" && state.search.hits.length === 0 && <p>{t("recon.search.none")}</p>}
                  {showHits && state.search.status === "DONE" && state.search.hits.length > 0 && <p>{state.search.hits.length === 1 ? t("recon.search.one") : t("recon.search.many", { n: state.search.hits.length })}</p>}
                </div>
                {showHits && state.search.status === "DONE" && state.search.hits.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {state.search.hits.map((hit) => (
                      <HitOption key={hit.flatCode} hit={hit} name={groupName} selected={state.flatCode} disabled={busy} onChoose={(flatCode) => dispatch({ type: "SELECT_FLAT", flatCode })} />
                    ))}
                  </ul>
                )}
              </div>
            </fieldset>

            {state.flatCode !== null && <p className="tnum text-body font-semibold">{t("recon.chosen", { flat: state.flatCode })}</p>}

            <div className="flex flex-col gap-2">
              <label htmlFor={reasonId} className="text-body font-semibold">
                {t("recon.panel.reason")}
              </label>
              <textarea
                id={reasonId}
                rows={3}
                value={state.reason}
                disabled={busy}
                onChange={(event) => dispatch({ type: "SET_REASON", reason: event.target.value })}
                aria-describedby={`${reasonId}-hint`}
                aria-invalid={state.reasonAsked && !reasonValid(state.reason) ? true : undefined}
                className="w-full rounded-control border-2 border-control bg-paper p-3 text-body"
              />
              <p id={`${reasonId}-hint`} className="flex justify-between gap-4 text-caption text-ink-2">
                <span>{t("recon.panel.reasonHint")}</span>
                <span className="tnum shrink-0">{reasonCounter(state.reason)}</span>
              </p>
              {state.reasonAsked && !reasonValid(state.reason) && (
                <p role="alert" className="text-body font-semibold text-caution">
                  {t("recon.error.reason")}
                </p>
              )}
              <p className="sr-only">{t("recon.panel.reasonMax", { max: REASON_MAX })}</p>
            </div>

            {review.upiId !== null && (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
                <input type="checkbox" checked={state.remember} disabled={busy} onChange={(event) => dispatch({ type: "SET_REMEMBER", remember: event.target.checked })} className="h-5 w-5 shrink-0" />
                {t("recon.panel.remember")}
              </label>
            )}

            {needsSecondApprover(credit, BigInt(review.thresholdPaise)) && <Notice>{thresholdNotice(BigInt(review.thresholdPaise))}</Notice>}

            <div className="flex flex-col gap-2">
              <Button disabled={!canPost(state)} loading={busy && lastKind === "MATCH"} loadingLabel={t("recon.panel.sending")} onClick={() => submit("MATCH")}>
                {postLabel(state.flatCode)}
              </Button>
              <Button variant="outlined" disabled={!canIgnore(state)} loading={busy && lastKind === "IGNORE"} loadingLabel={t("recon.panel.sending")} onClick={() => submit("IGNORE")}>
                {t("recon.panel.ignore")}
              </Button>
            </div>
          </>
        )}

        <div aria-live="polite" className="flex flex-col gap-3">
          {state.submit.status === "ERROR" && state.submit.error !== null && (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-control border-2 border-caution p-4">
              <p className="text-body font-semibold text-caution">{submitErrorText(state.submit.error)}</p>
              {state.submit.error === "CHANGED" && (
                <Button variant="outlined" onClick={() => router.refresh()}>
                  {t("recon.panel.reload")}
                </Button>
              )}
              {state.submit.error === "NETWORK" && lastKind !== null && (
                <Button variant="outlined" onClick={() => submit(lastKind)}>
                  {t("recon.panel.retry")}
                </Button>
              )}
            </div>
          )}
          {finished && result !== null && (
            <div className="flex flex-col gap-3">
              <Notice>
                <ul className="flex flex-col gap-1">
                  {resultLines(result).map((line, index) => (
                    <li key={index} className={index === 0 ? "font-semibold" : "tnum"}>
                      {line}
                    </li>
                  ))}
                  {result.kind === "POSTED" && result.payerNotice !== null && <li>{payerNoticeText(result.payerNotice)}</li>}
                </ul>
              </Notice>
              <Button onClick={next}>{nextRowId === null ? t("recon.panel.done") : t("recon.panel.next")}</Button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
