import { istDateOf } from "@/domain/time/calendar";
import type { ReplyDue } from "@/server/home/types";
import { formatDay, formatTimeIst } from "./format-date";
import { t } from "./messages";

/** "Reply due today, 5 pm", "Reply due 28 Oct, 5 pm" or "Reply overdue". The times are India time. */
export function replyDueText(reply: ReplyDue): string {
  if (reply.kind === "OVERDUE") return t("complaint.reply.overdue");
  const time = formatTimeIst(reply.dueAt);
  return reply.today ? t("complaint.reply.dueToday", { time }) : t("complaint.reply.dueOn", { date: formatDay(istDateOf(reply.dueAt)), time });
}
