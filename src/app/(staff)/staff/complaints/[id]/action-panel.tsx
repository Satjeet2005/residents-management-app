"use client";

import { useRouter } from "next/navigation";
import { useReducer, useRef } from "react";
import type { Controls } from "@/lib/staff-complaints/controls";
import { categoryLabel } from "@/lib/staff-complaints/labels";
import { type PanelAction, type PanelState, classifyPanelResponse, initialPanelState, isComplete, panelReducer, requestOf } from "@/lib/staff-complaints/panel";
import { PanelView } from "./panel-view";

type Props = {
  id: string;
  version: number;
  controls: Controls;
  staffUsers: readonly { id: string; name: string }[];
  currentCategory: string | null;
  needsReview: boolean;
};

/** What the confirmation names: who it was assigned to, the new category, or whether the comment is visible. */
function subjectOf(action: PanelAction, state: PanelState, staffUsers: Props["staffUsers"]): string | null {
  if (action === "ASSIGN") return staffUsers.find((user) => user.id === state.assigneeId)?.name ?? null;
  if (action === "CATEGORY") return categoryLabel(state.category);
  if (action === "COMMENT") return state.commentVisible ? "visible" : "internal";
  return null;
}

/**
 * The action panel of one complaint. It calls the existing staff routes with the version the page was shown with, so a complaint someone else changed is
 * refused (409) and the person is asked to reload. A second tap while an action is in flight does nothing (the reducer and a ref both guard it). On success
 * the page is refreshed and the confirmation says what changed.
 */
export function ActionPanel({ id, version, controls, staffUsers, currentCategory, needsReview }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(panelReducer, initialPanelState);
  const sending = useRef(false);

  async function submit(action: PanelAction) {
    if (sending.current) return;
    if (!isComplete(state, action)) {
      dispatch({ type: "SUBMIT", action });
      return;
    }
    sending.current = true;
    const subject = subjectOf(action, state, staffUsers);
    const request = requestOf(action, state, version);
    dispatch({ type: "SUBMIT", action });
    try {
      const response = await fetch(`/api/staff/complaints/${id}/${request.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) });
      const code = await response
        .json()
        .then((body: { error?: unknown }) => (typeof body.error === "string" ? body.error : null))
        .catch(() => null);
      const outcome = classifyPanelResponse(response.status, code);
      if (outcome === "OK") {
        dispatch({ type: "SUCCEEDED", subject });
        router.refresh();
      } else {
        dispatch({ type: "FAILED", error: outcome });
      }
    } catch {
      dispatch({ type: "FAILED", error: "NETWORK" });
    } finally {
      sending.current = false;
    }
  }

  return (
    <PanelView
      state={state}
      controls={controls}
      staffUsers={staffUsers}
      currentCategory={currentCategory}
      needsReview={needsReview}
      handlers={{
        onField: (field, value) => dispatch({ type: "FIELD", field, value }),
        onToggleVisible: () => dispatch({ type: "VISIBLE_TOGGLED" }),
        onOpenNote: (form) => dispatch({ type: "NOTE_OPENED", form }),
        onCloseNote: () => dispatch({ type: "NOTE_CLOSED" }),
        onSubmit: (action) => void submit(action),
        onReload: () => {
          dispatch({ type: "DISMISSED" });
          router.refresh();
        },
      }}
    />
  );
}
