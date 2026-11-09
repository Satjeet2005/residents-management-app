"use client";

import type { Controls } from "@/lib/staff-complaints/controls";
import { PanelView } from "./panel-view";
import { useStaffActions } from "./use-staff-actions";

type Props = {
  id: string;
  version: number;
  controls: Controls;
  staffUsers: readonly { id: string; name: string }[];
};

/** The action panel of one complaint, in the right-hand column from 1024px (D130). The actions and their rules are in `useStaffActions`. */
export function ActionPanel({ id, version, controls, staffUsers }: Props) {
  const { state, dispatch, submit, reload } = useStaffActions({ id, version, staffUsers });
  return (
    <PanelView
      state={state}
      controls={controls}
      staffUsers={staffUsers}
      handlers={{
        onField: (field, value) => dispatch({ type: "FIELD", field, value }),
        onToggleVisible: () => dispatch({ type: "VISIBLE_TOGGLED" }),
        onOpenNote: (form) => dispatch({ type: "NOTE_OPENED", form }),
        onCloseNote: () => dispatch({ type: "NOTE_CLOSED" }),
        onSubmit: (action) => void submit(action),
        onReload: reload,
      }}
    />
  );
}
