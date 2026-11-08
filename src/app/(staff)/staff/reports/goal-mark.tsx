import { CheckIcon, WarningIcon } from "@/components/icons";
import type { GoalMark } from "@/lib/reports/cards";
import { t } from "@/lib/messages";

/** The goal next to its metric: the target in words, and Met or Not met in words with an icon (never colour alone). With no data there is a target and no verdict. */
export function GoalLine({ mark }: { mark: GoalMark }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-2">
      <span>{mark.text}</span>
      {mark.status === "MET" && (
        <span className="inline-flex items-center gap-1 text-body font-semibold text-ink">
          <CheckIcon size={20} />
          {t("committee.goals.met")}
        </span>
      )}
      {mark.status === "NOT_MET" && (
        <span className="inline-flex items-center gap-1 text-body font-semibold text-caution">
          <WarningIcon size={20} />
          {t("committee.goals.notMet")}
        </span>
      )}
    </span>
  );
}
