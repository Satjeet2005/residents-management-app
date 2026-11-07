import { COMPLAINT_STEP_KEYS } from "@/domain/complaints/step";
import { t } from "@/lib/messages";
import { CheckIcon } from "./icons";
import { Tracker, type TrackerStep } from "./ui/tracker";

function stepLabel(key: (typeof COMPLAINT_STEP_KEYS)[number]): string {
  switch (key) {
    case "complaint.step.raised":
      return t("complaint.step.raised");
    case "complaint.step.assigned":
      return t("complaint.step.assigned");
    case "complaint.step.inProgress":
      return t("complaint.step.inProgress");
    case "complaint.step.resolved":
      return t("complaint.step.resolved");
  }
}

/** The four steps with the one at `current` marked: the steps before it are done, the ones after it are next. */
export function complaintSteps(current: number): TrackerStep[] {
  return COMPLAINT_STEP_KEYS.map((key, index) => ({ label: stepLabel(key), state: index < current ? "done" : index === current ? "current" : "upcoming" }));
}

/** The four-step tracker of a complaint, without its own "Step n of 4" line (the screen writes its own, with the reply time). */
export function ComplaintTracker({ current }: { current: number }) {
  return <Tracker steps={complaintSteps(current)} label={t("complaint.progress")} showStepText={false} />;
}

/** The status at the right of a title: a small mark (a check once past the last step, else a ring) and the word. Never the mark alone. */
export function ComplaintStatusMark({ current, label }: { current: number; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-body font-semibold">
      {current === COMPLAINT_STEP_KEYS.length - 1 ? <CheckIcon size={20} /> : <span aria-hidden="true" className="h-4 w-4 rounded-full border-[5px] border-accent" />}
      {label}
    </span>
  );
}
