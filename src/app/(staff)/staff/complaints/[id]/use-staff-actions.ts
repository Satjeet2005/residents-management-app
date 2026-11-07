"use client";

import { useRouter } from "next/navigation";
import { useReducer, useRef } from "react";
import { categoryLabel } from "@/lib/staff-complaints/labels";
import { type PanelAction, type PanelState, classifyPanelResponse, initialPanelState, isComplete, panelReducer, requestOf } from "@/lib/staff-complaints/panel";

export type StaffUser = { id: string; name: string };

/** What the confirmation names: who it was assigned to, the new category, or whether the comment is visible. */
function subjectOf(action: PanelAction, state: PanelState, staffUsers: readonly StaffUser[]): string | null {
  if (action === "ASSIGN") return staffUsers.find((user) => user.id === state.assigneeId)?.name ?? null;
  if (action === "CATEGORY") return categoryLabel(state.category);
  if (action === "COMMENT") return state.commentVisible ? "visible" : "internal";
  return null;
}

/**
 * The state and the requests of the staff actions of one complaint, shared by the side panel and the phone's actions sheet and bar. The actions call the existing
 * staff routes with the version the page was shown with, so a complaint someone else changed is refused (409) and the person is asked to reload. A second tap while
 * an action is in flight does nothing (the reducer and a ref both guard it). On success the page is refreshed.
 */
export function useStaffActions({ id, version, staffUsers }: { id: string; version: number; staffUsers: readonly StaffUser[] }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(panelReducer, initialPanelState);
  const sending = useRef(false);

  /** Sends the action; true when it worked (the caller may then close its sheet), false when it was refused, incomplete or already in flight. */
  async function submit(action: PanelAction): Promise<boolean> {
    if (sending.current) return false;
    if (!isComplete(state, action)) {
      dispatch({ type: "SUBMIT", action });
      return false;
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
        return true;
      }
      dispatch({ type: "FAILED", error: outcome });
      return false;
    } catch {
      dispatch({ type: "FAILED", error: "NETWORK" });
      return false;
    } finally {
      sending.current = false;
    }
  }

  const reload = () => {
    dispatch({ type: "DISMISSED" });
    router.refresh();
  };

  return { state, dispatch, submit, reload };
}
