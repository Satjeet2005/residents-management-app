/** D233: the eight spare demo logins (existing generated residents), the same phones as the table in deployment.md. `dueRupees` is the October bill; `amountDueRupees` is bill plus the 17-day late fee at 27 October 2026 (12% a year on the bill, 365-day year, rounded to whole rupees), worked out by hand here, not by the app. */
export const SPARE_LOGINS: readonly { phone: string; flatCode: string; dueRupees: number; amountDueRupees: number }[] = [
  { phone: "5000000265", flatCode: "T03-0104", dueRupees: 8580, amountDueRupees: 8628 },
  { phone: "5000000304", flatCode: "T03-0603", dueRupees: 5525, amountDueRupees: 5556 },
  { phone: "5000000349", flatCode: "T03-1104", dueRupees: 7475, amountDueRupees: 7517 },
  { phone: "5000000467", flatCode: "T04-1107", dueRupees: 7475, amountDueRupees: 7517 },
  { phone: "5000000650", flatCode: "T06-0306", dueRupees: 6370, amountDueRupees: 6406 },
  { phone: "5000000763", flatCode: "T07-0104", dueRupees: 7475, amountDueRupees: 7517 },
  { phone: "5000000821", flatCode: "T07-0904", dueRupees: 6370, amountDueRupees: 6406 },
  { phone: "5000000976", flatCode: "T08-1405", dueRupees: 8580, amountDueRupees: 8628 },
];
