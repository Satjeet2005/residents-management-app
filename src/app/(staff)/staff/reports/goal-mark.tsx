import { CheckIcon, WarningIcon } from "@/components/icons";
import type { GoalMark } from "@/lib/reports/cards";
import { t } from "@/lib/messages";

/** Met or Not met in words with an icon (never colour alone); nothing when there is no data, because then there is no verdict. */
export function GoalTag({ status }: { status: GoalMark["status"] }) {
  if (status === "MET")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-body font-semibold text-ink">
        <CheckIcon size={20} />
        {t("committee.goals.met")}
      </span>
    );
  if (status === "NOT_MET")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-body font-semibold text-caution">
        <WarningIcon size={20} />
        {t("committee.goals.notMet")}
      </span>
    );
  return null;
}

/** The goal next to its metric: the target in words, and Met or Not met in words with an icon (never colour alone). With no data there is a target and no verdict. */
export function GoalLine({ mark }: { mark: GoalMark }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-2">
      <span>{mark.text}</span>
      <GoalTag status={mark.status} />
    </span>
  );
}
