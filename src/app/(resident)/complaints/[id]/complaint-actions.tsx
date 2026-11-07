"use client";

import { useRouter } from "next/navigation";
import { useReducer, useRef } from "react";
import { actionReducer, classifyAction, confirmBodyOf, initialActionState, isReasonValid } from "@/lib/complaint-actions";
import { ActionsView } from "./actions-view";

/**
 * The buttons under a complaint: they call the existing routes (`/confirm`, `/reopen`). A change under the person's feet (409) asks for a reload;
 * any other failure keeps what was written and offers Try again. A second tap while sending does nothing.
 */
export function ComplaintActions({ id, safety, pending, autoCloseDays }: { id: string; safety: boolean; pending: boolean; autoCloseDays: number }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(actionReducer, initialActionState);
  const sending = useRef(false);

  async function send() {
    if (sending.current) return;
    const reopening = state.mode === "REASON";
    if (reopening && !isReasonValid(state.reason)) {
      dispatch({ type: "SUBMIT" });
      return;
    }
    sending.current = true;
    dispatch({ type: "SUBMIT" });
    try {
      const response = await fetch(`/api/complaints/${id}/${reopening ? "reopen" : "confirm"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reopening ? { reason: state.reason } : confirmBodyOf(state)),
      });
      const outcome = classifyAction(response.status);
      if (outcome.kind === "OK") {
        dispatch({ type: "SUCCEEDED", done: reopening ? "REOPENED" : "CONFIRMED" });
        router.refresh();
        return;
      }
      dispatch({ type: "FAILED", error: outcome.error });
    } catch {
      dispatch({ type: "FAILED", error: "NETWORK" });
    }
    sending.current = false;
  }

  return (
    <ActionsView
      state={state}
      safety={safety}
      pending={pending}
      autoCloseDays={autoCloseDays}
      onFixed={() => dispatch({ type: "CHOOSE_FIXED" })}
      onProblem={() => dispatch({ type: "CHOOSE_PROBLEM" })}
      onBack={() => dispatch({ type: "BACK" })}
      onRating={(value) => dispatch({ type: "RATING_CHOSEN", value })}
      onReason={(value) => dispatch({ type: "REASON_CHANGED", value })}
      onSend={send}
      onReload={() => router.refresh()}
    />
  );
}
