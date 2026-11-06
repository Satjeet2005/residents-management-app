import type { Dues } from "@/domain/billing/dues";
import type { ComplaintStatus } from "@/domain/complaints/step";
import type { Paise } from "@/domain/money/money";
import type { CalendarDate } from "@/domain/time/calendar";

export type FlatRelation = "OWNER" | "TENANT" | "FAMILY";
export type EntryType = "BILL" | "LATE_FEE" | "PAYMENT" | "REVERSAL" | "ADJUSTMENT";

/** When a reply to a complaint is due, worked out at one moment: absent once the first reply has been given. */
export type ReplyDue = { kind: "OVERDUE" } | { kind: "DUE"; dueAt: number; today: boolean };

export type HomeComplaint = {
  /** First line of the complaint, at most 60 characters. */
  title: string;
  status: ComplaintStatus;
  /** Index of the current step, 0 to 3. */
  current: 0 | 1 | 2 | 3;
  needsAnswer: boolean;
  reply: ReplyDue | null;
};

/** A visitor expected today. Only the time: the name is personal data and the Home does not show it. */
export type HomeVisitor = { expectedAt: number };
export type RecentEntry = { entryType: EntryType; date: CalendarDate; amountPaise: Paise };

/**
 * Everything the resident Home shows, as plain data: strings, numbers, bigint paise, CalendarDate texts and epoch
 * milliseconds. No Date objects, functions or database rows. It is read-only; nothing here can change money.
 */
export type HomeData =
  | { kind: "NO_FLAT"; userName: string; asOf: CalendarDate }
  | {
      kind: "OK";
      /** The India date the dues are worked out for (the business date). */
      asOf: CalendarDate;
      userName: string;
      flat: { code: string; relation: FlatRelation };
      /** True when the person has more than one current flat: only the first by code is shown (multi-flat is out of scope). */
      moreThanOneFlat: boolean;
      dues: Dues;
      complaint: HomeComplaint | null;
      /** Open complaints besides the one shown. */
      otherOpenComplaints: number;
      visitors: readonly HomeVisitor[];
      recent: readonly RecentEntry[];
      /** False when the flat has no ledger entry at all (a first-run flat). */
      hasActivity: boolean;
      emergency: { dutyManagerPhone: string | null; emergencyServicesPhone: string | null };
    };
