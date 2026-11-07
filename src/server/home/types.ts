import type { Dues } from "@/domain/billing/dues";
import type { SafetyCategory } from "@/domain/complaints/safety";
import type { SafetyAlertState } from "@/domain/complaints/safety-alert";
import type { ComplaintStatus } from "@/domain/complaints/step";
import type { Paise } from "@/domain/money/money";
import type { CalendarDate } from "@/domain/time/calendar";

export type FlatRelation = "OWNER" | "TENANT" | "FAMILY";
export type EntryType = "BILL" | "LATE_FEE" | "PAYMENT" | "REVERSAL" | "ADJUSTMENT";

/** When a reply to a complaint is due, worked out at one moment: absent once the first reply has been given. */
export type ReplyDue = { kind: "OVERDUE" } | { kind: "DUE"; dueAt: number; today: boolean };

export type HomeComplaint = {
  id: string;
  /** First line of the complaint, at most 60 characters. */
  title: string;
  status: ComplaintStatus;
  /** Index of the current step, 0 to 3. */
  current: 0 | 1 | 2 | 3;
  needsAnswer: boolean;
  reply: ReplyDue | null;
};

/** The alert above the dues while the flat has an open safety complaint (design 1a to 1c, D126). */
export type HomeSafetyAlert = {
  state: SafetyAlertState;
  /** What the report was about, when a safety word said so; null for a declared danger with no word. */
  category: SafetyCategory | null;
  /** When the duty manager acknowledged it (epoch ms); null until then. */
  seenAt: number | null;
  /** The number the Call button dials; null when no number is configured. */
  callPhone: string | null;
};

/** A visitor expected today. Only the time: the name is personal data and the Home does not show it. */
/** The society's account for a bank transfer, from the society_bank_account setting, shown as given. */
export type BankAccount = { name: string; number: string; ifsc: string };

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
      /** Present while the flat has an open safety complaint, above the dues. */
      safetyAlert: HomeSafetyAlert | null;
      visitors: readonly HomeVisitor[];
      recent: readonly RecentEntry[];
      /** False when the flat has no ledger entry at all (a first-run flat). */
      hasActivity: boolean;
      emergency: { dutyManagerPhone: string | null; emergencyServicesPhone: string | null };
      /** Where to pay by bank transfer instead; null when the setting is missing or not valid. */
      bankAccount: BankAccount | null;
      /** "LAST_FAILED": the latest payment attempt failed within the last 24 hours and no later attempt exists. */
      paymentNotice: "LAST_FAILED" | null;
    };
