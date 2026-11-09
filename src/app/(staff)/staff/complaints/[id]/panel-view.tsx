"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { t } from "@/lib/messages";
import type { Controls } from "@/lib/staff-complaints/controls";
import { COMMENT_MAX, NOTE_MAX, type NoteForm, type PanelAction, type PanelError, type PanelState, type TextField, countChars } from "@/lib/staff-complaints/panel";

const FIELD = "w-full rounded-control border-2 border-control bg-paper px-4 py-3 text-body text-ink";
const SELECT = "min-h-12 w-full rounded-control border-2 border-control bg-paper px-4 text-body text-ink";

export type PanelHandlers = {
  onField: (field: TextField, value: string) => void;
  onToggleVisible: () => void;
  onOpenNote: (form: NoteForm) => void;
  onCloseNote: () => void;
  onSubmit: (action: PanelAction) => void;
  onReload: () => void;
};

export type PanelViewProps = {
  state: PanelState;
  controls: Controls;
  staffUsers: readonly { id: string; name: string }[];
  handlers: PanelHandlers;
  /** A prefix for every element id, so two panels on one page (the side panel and the actions sheet) never share one. */
  idPrefix?: string;
};

/** What worked, in words: the action and the one fact it changed (a name, a category, or whether the comment is visible). */
export function doneText(done: NonNullable<PanelState["done"]>): string {
  switch (done.action) {
    case "ASSIGN":
      return t("staffComplaints.done.assign", { name: done.subject ?? "" });
    case "START":
      return t("staffComplaints.done.start");
    case "RESOLVE":
      return t("staffComplaints.done.resolve");
    case "COMMENT":
      return done.subject === "visible" ? t("staffComplaints.done.commentVisible") : t("staffComplaints.done.commentInternal");
    case "ACKNOWLEDGE":
      return t("staffComplaints.done.acknowledge");
    case "CLOSE":
      return t("staffComplaints.done.close");
  }
}

export function errorText(error: PanelError): string {
  switch (error) {
    case "STALE":
      return t("staffComplaints.error.stale");
    case "FORBIDDEN":
      return t("staffComplaints.error.forbidden");
    case "NOT_FOUND":
      return t("staffComplaints.error.notFound");
    case "ASSIGNEE_INVALID":
      return t("staffComplaints.error.assignee");
    case "VALIDATION":
      return t("staffComplaints.error.validation");
    case "NETWORK":
      return t("staffComplaints.error.network");
    case "SERVER":
      return t("staffComplaints.error.server");
  }
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-b border-hairline pb-4">
      <h3 id={id} className="text-body font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Invalid({ id, show, text }: { id: string; show: boolean; text: string }) {
  return show ? (
    <p id={id} className="text-body font-semibold text-caution">
      {text}
    </p>
  ) : null;
}

/** The button of an action, outlined unless it is the one filled control of the page: it says "Working" while its own action is in flight and is off while any action is. */
function ActionButton({ action, state, label, onSubmit, disabled = false, variant = "outlined" }: { action: PanelAction; state: PanelState; label: string; onSubmit: (action: PanelAction) => void; disabled?: boolean; variant?: "outlined" | "primary" }) {
  return (
    <Button variant={variant} loading={state.pending === action} loadingLabel={t("staffComplaints.working")} disabled={disabled || (state.pending !== null && state.pending !== action)} onClick={() => onSubmit(action)}>
      {label}
    </Button>
  );
}

/**
 * The action panel (D130): assign, status, comment (the category is the chips of the Details tab, D239). Pure markup over the reducer's state. Focus: the first field of the form whose submit
 * was refused, the note box when it opens, and the result line after every answer. The result line is a live region. Every button is outlined except the duty
 * manager's "I have seen this", which is the one filled control of the page while a safety complaint is unacknowledged. "I have seen this" and "Close this
 * safety complaint" appear only when `controls` offers them, which is only to the duty manager on a safety complaint.
 */
export function PanelView({ state, controls, staffUsers, handlers, idPrefix = "" }: PanelViewProps) {
  const i = (name: string): string => `${idPrefix}${name}`;
  const resultRef = useRef<HTMLDivElement>(null);
  const assignRef = useRef<HTMLSelectElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const resolveNoteRef = useRef<HTMLTextAreaElement>(null);
  const closeNoteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.done !== null || state.error !== null) resultRef.current?.focus();
  }, [state.done, state.error]);
  useEffect(() => {
    const target = state.invalid === "ASSIGN" ? assignRef : state.invalid === "COMMENT" ? commentRef : state.invalid === "RESOLVE" ? resolveNoteRef : state.invalid === "CLOSE" ? closeNoteRef : null;
    target?.current?.focus();
  }, [state.invalid]);
  useEffect(() => {
    if (state.noteOpen === "RESOLVE") resolveNoteRef.current?.focus();
    if (state.noteOpen === "CLOSE") closeNoteRef.current?.focus();
  }, [state.noteOpen]);

  const busy = state.pending !== null;
  const showStatus = controls.start || controls.resolve;
  return (
    <div className="flex flex-col gap-4">
      <div ref={resultRef} tabIndex={-1} role={state.error === null ? "status" : "alert"} className="flex flex-col items-start gap-2">
        {state.done !== null && <Notice>{doneText(state.done)}</Notice>}
        {state.error !== null && <Notice kind="alert">{errorText(state.error.error)}</Notice>}
        {state.error?.error === "STALE" && (
          <Button variant="outlined" onClick={handlers.onReload}>
            {t("staffComplaints.reload")}
          </Button>
        )}
      </div>

      {(controls.acknowledge || controls.close) && (
        <Section id={i("panel-safety")} title={t("staffComplaints.safetyPanel.heading")}>
          {controls.acknowledge && (
            <>
              <p className="text-body">{t("staffComplaints.safetyPanel.acknowledgeHint")}</p>
              <div>
                <ActionButton action="ACKNOWLEDGE" state={state} label={t("staffComplaints.safetyPanel.acknowledge")} onSubmit={handlers.onSubmit} variant="primary" />
              </div>
            </>
          )}
          {controls.close && state.noteOpen !== "CLOSE" && (
            <div>
              <Button variant="outlined" disabled={busy} onClick={() => handlers.onOpenNote("CLOSE")}>
                {t("staffComplaints.safetyPanel.close")}
              </Button>
            </div>
          )}
          {controls.close && state.noteOpen === "CLOSE" && (
            <div className="flex flex-col gap-2">
              <label htmlFor={i("close-note")} className="text-body font-semibold">
                {t("staffComplaints.note.label")}
              </label>
              <p id={i("close-note-hint")} className="text-caption text-ink-2">
                {t("staffComplaints.safetyPanel.closeHint")}
              </p>
              <textarea
                ref={closeNoteRef}
                id={i("close-note")}
                rows={3}
                value={state.closeNote}
                onChange={(event) => handlers.onField("closeNote", event.target.value)}
                disabled={busy}
                aria-invalid={state.invalid === "CLOSE" || undefined}
                aria-describedby={state.invalid === "CLOSE" ? `${i("close-note-hint")} ${i("close-note-error")}` : i("close-note-hint")}
                className={FIELD}
              />
              <p className="tnum text-caption text-ink-2">{t("staffComplaints.count", { n: countChars(state.closeNote), max: NOTE_MAX })}</p>
              <Invalid id={i("close-note-error")} show={state.invalid === "CLOSE"} text={t("staffComplaints.note.invalid")} />
              <div className="flex flex-wrap gap-2">
                <ActionButton action="CLOSE" state={state} label={t("staffComplaints.safetyPanel.close")} onSubmit={handlers.onSubmit} />
                <Button variant="outlined" disabled={busy} onClick={handlers.onCloseNote}>
                  {t("staffComplaints.cancel")}
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}

      {controls.assign && (
        <Section id={i("panel-assign")} title={t("staffComplaints.assign.heading")}>
          <label htmlFor={i("assign-select")} className="text-body">
            {t("staffComplaints.assign.label")}
          </label>
          <select
            ref={assignRef}
            id={i("assign-select")}
            value={state.assigneeId}
            onChange={(event) => handlers.onField("assigneeId", event.target.value)}
            disabled={busy}
            aria-invalid={state.invalid === "ASSIGN" || undefined}
            aria-describedby={state.invalid === "ASSIGN" ? i("assign-error") : undefined}
            className={SELECT}
          >
            <option value="">{t("staffComplaints.assign.choose")}</option>
            {staffUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <Invalid id={i("assign-error")} show={state.invalid === "ASSIGN"} text={t("staffComplaints.assign.invalid")} />
          <div>
            <ActionButton action="ASSIGN" state={state} label={t("staffComplaints.assign.button")} onSubmit={handlers.onSubmit} />
          </div>
        </Section>
      )}

      {showStatus && (
        <Section id={i("panel-status")} title={t("staffComplaints.statusPanel.heading")}>
          <div className="flex flex-wrap gap-2">
            {controls.start && <ActionButton action="START" state={state} label={t("staffComplaints.statusPanel.start")} onSubmit={handlers.onSubmit} />}
            {controls.resolve && state.noteOpen !== "RESOLVE" && (
              <Button variant="outlined" disabled={busy} onClick={() => handlers.onOpenNote("RESOLVE")}>
                {t("staffComplaints.statusPanel.resolve")}
              </Button>
            )}
          </div>
          {controls.resolve && state.noteOpen === "RESOLVE" && (
            <div className="flex flex-col gap-2">
              <label htmlFor={i("resolve-note")} className="text-body font-semibold">
                {t("staffComplaints.note.label")}
              </label>
              <p id={i("resolve-note-hint")} className="text-caption text-ink-2">
                {t("staffComplaints.statusPanel.noteHint")}
              </p>
              <textarea
                ref={resolveNoteRef}
                id={i("resolve-note")}
                rows={3}
                value={state.resolveNote}
                onChange={(event) => handlers.onField("resolveNote", event.target.value)}
                disabled={busy}
                aria-invalid={state.invalid === "RESOLVE" || undefined}
                aria-describedby={state.invalid === "RESOLVE" ? `${i("resolve-note-hint")} ${i("resolve-note-error")}` : i("resolve-note-hint")}
                className={FIELD}
              />
              <p className="tnum text-caption text-ink-2">{t("staffComplaints.count", { n: countChars(state.resolveNote), max: NOTE_MAX })}</p>
              <Invalid id={i("resolve-note-error")} show={state.invalid === "RESOLVE"} text={t("staffComplaints.note.invalid")} />
              <div className="flex flex-wrap gap-2">
                <ActionButton action="RESOLVE" state={state} label={t("staffComplaints.statusPanel.send")} onSubmit={handlers.onSubmit} />
                <Button variant="outlined" disabled={busy} onClick={handlers.onCloseNote}>
                  {t("staffComplaints.cancel")}
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}

      {controls.comment && (
        <Section id={i("panel-comment")} title={t("staffComplaints.comment.heading")}>
          <label htmlFor={i("comment-text")} className="text-body">
            {t("staffComplaints.comment.label")}
          </label>
          <textarea
            ref={commentRef}
            id={i("comment-text")}
            rows={4}
            value={state.commentText}
            onChange={(event) => handlers.onField("commentText", event.target.value)}
            disabled={busy}
            aria-invalid={state.invalid === "COMMENT" || undefined}
            aria-describedby={state.invalid === "COMMENT" ? i("comment-error") : undefined}
            className={FIELD}
          />
          <p className="tnum text-caption text-ink-2">{t("staffComplaints.count", { n: countChars(state.commentText), max: COMMENT_MAX })}</p>
          <Invalid id={i("comment-error")} show={state.invalid === "COMMENT"} text={t("staffComplaints.comment.invalid")} />
          <label htmlFor={i("comment-visible")} className="flex min-h-12 items-center gap-3 text-body">
            <input id={i("comment-visible")} type="checkbox" checked={state.commentVisible} onChange={handlers.onToggleVisible} disabled={busy} aria-describedby={i("comment-visible-hint")} className="h-6 w-6" />
            {t("staffComplaints.comment.visible")}
          </label>
          <p id={i("comment-visible-hint")} className="text-caption text-ink-2">
            {state.commentVisible ? t("staffComplaints.comment.visibleOn") : t("staffComplaints.comment.visibleOff")}
          </p>
          <div>
            <ActionButton action="COMMENT" state={state} label={t("staffComplaints.comment.button")} onSubmit={handlers.onSubmit} />
          </div>
        </Section>
      )}
    </div>
  );
}
