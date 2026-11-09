"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import type { CategoryCode } from "@/domain/complaints/taxonomy";
import { chipsReducer, initialChips, tapSends } from "@/lib/staff-complaints/category-chips";
import { classifyPanelResponse } from "@/lib/staff-complaints/panel";
import { CategoryChipsView } from "./category-chips-view";

/**
 * The complaint's category as five chips (D239). A tap on another chip calls the category route at once with the version the page was shown with, then with the
 * version each answer returns, so "Undo" (six seconds) is a second change to the category before. A stale version is refused (409) and the person is asked to reload.
 */
export function CategoryChips({ id, version, category, closed }: { id: string; version: number; category: string | null; closed: boolean }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(chipsReducer, initialChips(category, version));
  const sending = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => dispatch({ type: "PAGE_CHANGED", category, version }), [category, version]);
  const until = state.undo?.until ?? null;
  // The message and Undo are below the chips; on a phone the pinned bar covers the bottom of the screen, so they are scrolled clear of it (scroll-margin on the box).
  useEffect(() => {
    if (until !== null) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [until]);
  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(() => dispatch({ type: "EXPIRED", at: until }), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);

  async function change(to: CategoryCode, undoable: boolean): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    dispatch({ type: "STARTED" });
    const from = state.category;
    try {
      const response = await fetch(`/api/staff/complaints/${id}/category`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: to, expectedVersion: state.version }) });
      const body = (await response.json().catch(() => null)) as { complaint?: { version?: unknown }; error?: unknown } | null;
      const outcome = classifyPanelResponse(response.status, typeof body?.error === "string" ? body.error : null);
      const next = body?.complaint?.version;
      if (outcome === "OK" && typeof next === "number") {
        dispatch({ type: "CHANGED", to, from, version: next, at: Date.now(), undoable });
        router.refresh();
      } else {
        dispatch({ type: "FAILED", error: outcome === "OK" ? "SERVER" : outcome });
      }
    } catch {
      dispatch({ type: "FAILED", error: "NETWORK" });
    } finally {
      sending.current = false;
    }
  }

  return (
    <CategoryChipsView
      feedbackRef={feedback}
      state={state}
      closed={closed}
      handlers={{
        onTap: (code) => {
          if (tapSends({ code, current: state.category, closed, pending: state.pending })) void change(code, true);
        },
        onUndo: () => {
          if (state.undo !== null) void change(state.undo.previous, false);
        },
        onReload: () => router.refresh(),
      }}
    />
  );
}
