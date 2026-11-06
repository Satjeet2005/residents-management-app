/**
 * Every visible string of the app, in English (D2). Screens call `t("key")` and never write a sentence in the code, so
 * another language is a second file with the same keys. A test (tests/lib/messages.test.ts) fails when a key used in the code
 * is missing here or a key here is used nowhere. Parameters are written {like_this}.
 */
export const en = {
  "complaint.step.raised": "Raised",
  "complaint.step.assigned": "Assigned",
  "complaint.step.inProgress": "In progress",
  "complaint.step.resolved": "Resolved",
  "complaint.reply.dueToday": "Reply due today, {time}",
  "complaint.reply.dueOn": "Reply due {date}, {time}",
  "complaint.reply.overdue": "Reply overdue",
} as const satisfies Record<string, string>;
