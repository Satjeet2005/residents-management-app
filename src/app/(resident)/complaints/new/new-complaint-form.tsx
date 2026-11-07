"use client";

import { useRouter } from "next/navigation";
import { useReducer, useRef } from "react";
import { classifyCreate, complaintFormReducer, fieldErrorsOf, initialComplaintForm, requestBodyOf } from "@/lib/complaint-form";
import { NewComplaintView } from "./new-complaint-view";

/** The raise form: posts to POST /api/complaints and goes to the new complaint with a confirmation. A second tap while sending does nothing. */
export function NewComplaintForm({ dutyManagerPhone }: { dutyManagerPhone: string | null }) {
  const [state, dispatch] = useReducer(complaintFormReducer, initialComplaintForm);
  const router = useRouter();
  const sending = useRef(false);

  async function submit() {
    if (sending.current) return;
    if (fieldErrorsOf(state).length > 0) {
      dispatch({ type: "SUBMIT" });
      return;
    }
    sending.current = true;
    dispatch({ type: "SUBMIT" });
    try {
      const response = await fetch("/api/complaints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBodyOf(state)) });
      const outcome = classifyCreate(response.status, await response.json().catch(() => null));
      if (outcome.kind === "CREATED") {
        router.push(`/complaints/${outcome.id}?sent=1`);
        return;
      }
      dispatch({ type: "SUBMIT_FAILED", error: outcome.error });
    } catch {
      dispatch({ type: "SUBMIT_FAILED", error: "NETWORK" });
    }
    sending.current = false;
  }

  return (
    <NewComplaintView
      state={state}
      dutyManagerPhone={dutyManagerPhone}
      onBodyChange={(value) => dispatch({ type: "BODY_CHANGED", value })}
      onDangerChoose={(value) => dispatch({ type: "DANGER_CHOSEN", value })}
      onSubmit={submit}
    />
  );
}
