import { z } from "zod";
import { type DueBill, type DueEntry, computeDues } from "@/domain/billing/dues";
import { type LateFeePolicy, validateLateFeePolicy } from "@/domain/billing/late-fee";
import { DEFAULT_SAFETY_ACK_TIMEOUT_MINUTES, safetyAlertState } from "@/domain/complaints/safety-alert";
import { detectSafetyWords } from "@/domain/complaints/safety";
import { type ComplaintStatus, complaintStep } from "@/domain/complaints/step";
import { type CalendarDate, istDateOf } from "@/domain/time/calendar";
import type { BankAccount, EntryType, FlatRelation, HomeComplaint, HomeData, HomeSafetyAlert, RecentEntry, ReplyDue } from "./types";

/**
 * The rows the queries return, as plain values (the queries file turns a Prisma row into one of these). The mapper below is
 * pure: rows in, the Home data out, so it is tested without a database.
 */
export type MembershipRow = { flatId: string; flatCode: string; relation: FlatRelation };
export type BillRow = { id: string; period: Date; issuedOn: Date; dueOn: Date; amountPaise: bigint };
export type EntryRow = {
  id: string;
  entryType: EntryType;
  direction: "CHARGE" | "PAYMENT";
  amountPaise: bigint;
  effectiveDate: Date;
  billId: string | null;
  reversesEntryId: string | null;
  createdAt: Date;
};
export type ComplaintRow = { id: string; safetyFlag: boolean; body: string; status: ComplaintStatus; createdAt: Date; responseDueAt: Date | null; firstResponseAt: Date | null };
export type VisitorRow = { expectedAt: Date };
/** The newest payment attempt of the flat. */
export type AttemptRow = { status: "INITIATED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "RELEASED"; startedAt: Date };
export type SettingsRow = { key: string; value: unknown };

export type HomeInput = {
  userName: string;
  now: number;
  memberships: readonly MembershipRow[];
  /** Everything below belongs to the flat of the first membership by code, and to no other flat. */
  bills: readonly BillRow[];
  entries: readonly EntryRow[];
  complaints: readonly ComplaintRow[];
  visitors: readonly VisitorRow[];
  settings: readonly SettingsRow[];
  /** The flat's newest payment attempt, or null when it has none. */
  latestAttempt: AttemptRow | null;
};

/** A database DATE (UTC midnight) as "YYYY-MM-DD". */
export const calendarDateOf = (date: Date): CalendarDate => date.toISOString().slice(0, 10);

const policySchema = z.object({ annualRateBps: z.number().int(), capBps: z.number().int(), daysInYear: z.number().int() });

/** The society's late-fee policy from its setting. A missing or invalid setting throws: never guess a rate for money. */
export function parsePolicy(settings: readonly SettingsRow[]): LateFeePolicy {
  const row = settings.find((s) => s.key === "late_fee_policy");
  const parsed = policySchema.safeParse(row?.value);
  if (!parsed.success) throw new Error("The late_fee_policy setting is missing or not valid");
  validateLateFeePolicy(parsed.data);
  return parsed.data;
}

const bankSchema = z.object({ name: z.string().min(1).max(100), number: z.string().min(1).max(40), ifsc: z.string().min(1).max(20) });

/** The society's bank account for a transfer, or null when the setting is missing or not valid (the panel then shows no payee lines). */
export function parseBankAccount(settings: readonly SettingsRow[]): BankAccount | null {
  const parsed = bankSchema.safeParse(settings.find((s) => s.key === "society_bank_account")?.value);
  return parsed.success ? parsed.data : null;
}

const DAY_MS = 86_400_000;

/**
 * "LAST_FAILED" when the newest attempt FAILED and started within the last 24 hours (so a failure of an older attempt, or
 * any later attempt of any state, shows nothing). Age is counted from the start time, which is on the same clock as `now`
 * (the business clock, D97), so the notice also works when the date is frozen for a demo.
 */
export function paymentNoticeOf(latest: AttemptRow | null, now: number): "LAST_FAILED" | null {
  if (latest === null || latest.status !== "FAILED") return null;
  return now - latest.startedAt.getTime() <= DAY_MS ? "LAST_FAILED" : null;
}

export const phoneSetting = (settings: readonly SettingsRow[], key: string): string | null => {
  const value = settings.find((s) => s.key === key)?.value;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

/** `safety_ack_timeout_minutes`: a whole number of minutes from 1 to 1,440; anything else is the default of 5. */
export function safetyTimeoutMinutes(settings: readonly SettingsRow[]): number {
  const value = settings.find((s) => s.key === "safety_ack_timeout_minutes")?.value;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1440 ? value : DEFAULT_SAFETY_ACK_TIMEOUT_MINUTES;
}

/**
 * The safety alert (D126): present while the flat has an open safety complaint (the newest one counts). The number to call is the duty manager's,
 * except in the NO_ANSWER state, where it is the emergency services number when one is configured (design 1c). A report that matched no safety word
 * (a declared danger, D121) has no category: the alert then says "Your report", never a guess.
 */
export function safetyAlertOf(complaints: readonly ComplaintRow[], settings: readonly SettingsRow[], now: number): HomeSafetyAlert | null {
  const newest = [...complaints].filter((c) => c.safetyFlag && c.status !== "CLOSED").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (newest === undefined) return null;
  const state = safetyAlertState({ createdAt: newest.createdAt.getTime(), firstResponseAt: newest.firstResponseAt?.getTime() ?? null, now, timeoutMinutes: safetyTimeoutMinutes(settings) });
  const duty = phoneSetting(settings, "duty_manager_phone");
  const services = phoneSetting(settings, "emergency_services_phone");
  return {
    state,
    category: detectSafetyWords(newest.body)[0]?.category ?? null,
    seenAt: state === "SEEN" ? (newest.firstResponseAt?.getTime() ?? null) : null,
    callPhone: state === "NO_ANSWER" ? (services ?? duty) : duty,
  };
}

/** The first line of a complaint, at most 60 characters (a cut one ends with an ellipsis). */
export function complaintTitle(body: string): string {
  const first = (body.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim();
  const chars = Array.from(first);
  return chars.length <= 60 ? first : `${chars.slice(0, 59).join("").trimEnd()}…`;
}

/** When the reply is due, or null once someone has replied. Overdue means the due time has passed and nobody has replied. */
export function computeReplyDue(input: { responseDueAt: number | null; firstResponseAt: number | null; now: number }): ReplyDue | null {
  if (input.firstResponseAt !== null || input.responseDueAt === null) return null;
  if (input.now > input.responseDueAt) return { kind: "OVERDUE" };
  return { kind: "DUE", dueAt: input.responseDueAt, today: istDateOf(input.responseDueAt) === istDateOf(input.now) };
}

export const toDueBill = (b: BillRow): DueBill => ({ id: b.id, period: calendarDateOf(b.period), issuedOn: calendarDateOf(b.issuedOn), dueOn: calendarDateOf(b.dueOn), amountPaise: b.amountPaise });
export const toDueEntry = (e: EntryRow): DueEntry => ({
  id: e.id,
  entryType: e.entryType,
  direction: e.direction,
  amountPaise: e.amountPaise,
  effectiveDate: calendarDateOf(e.effectiveDate),
  billId: e.billId,
  reversesEntryId: e.reversesEntryId,
});

/** The last two ledger entries up to today, newest first by effective date, then by the time they were recorded. */
function recentEntries(entries: readonly EntryRow[], today: CalendarDate): RecentEntry[] {
  return entries
    .filter((e) => calendarDateOf(e.effectiveDate) <= today)
    .sort((a, b) => (a.effectiveDate.getTime() !== b.effectiveDate.getTime() ? b.effectiveDate.getTime() - a.effectiveDate.getTime() : b.createdAt.getTime() - a.createdAt.getTime()))
    .slice(0, 2)
    .map((e) => ({ entryType: e.entryType, date: calendarDateOf(e.effectiveDate), amountPaise: e.amountPaise }));
}

/**
 * Builds the Home data. The flat shown is the first current membership by flat code (D6; several flats are out of scope, so
 * the first is shown and `moreThanOneFlat` says so). With no current membership the answer is NO_FLAT.
 */
export function assembleHome(input: HomeInput): HomeData {
  const today = istDateOf(input.now);
  const memberships = [...input.memberships].sort((a, b) => (a.flatCode < b.flatCode ? -1 : a.flatCode > b.flatCode ? 1 : 0));
  const shown = memberships[0];
  if (shown === undefined) return { kind: "NO_FLAT", userName: input.userName, asOf: today };

  const policy = parsePolicy(input.settings);
  const dues = computeDues({ bills: input.bills.map(toDueBill), entries: input.entries.map(toDueEntry), policy, today });

  const open = [...input.complaints].filter((c) => c.status !== "CLOSED").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const newest = open[0];
  const complaint: HomeComplaint | null =
    newest === undefined
      ? null
      : {
          id: newest.id,
          title: complaintTitle(newest.body),
          status: newest.status,
          current: complaintStep(newest.status).current,
          needsAnswer: complaintStep(newest.status).needsAnswer,
          reply: computeReplyDue({ responseDueAt: newest.responseDueAt?.getTime() ?? null, firstResponseAt: newest.firstResponseAt?.getTime() ?? null, now: input.now }),
        };

  return {
    kind: "OK",
    asOf: today,
    userName: input.userName,
    flat: { code: shown.flatCode, relation: shown.relation },
    moreThanOneFlat: new Set(memberships.map((m) => m.flatId)).size > 1,
    dues,
    complaint,
    otherOpenComplaints: Math.max(0, open.length - 1),
    safetyAlert: safetyAlertOf(input.complaints, input.settings, input.now),
    visitors: [...input.visitors].sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime()).map((v) => ({ expectedAt: v.expectedAt.getTime() })),
    recent: recentEntries(input.entries, today),
    hasActivity: input.entries.length > 0,
    bankAccount: parseBankAccount(input.settings),
    paymentNotice: paymentNoticeOf(input.latestAttempt, input.now),
    emergency: { dutyManagerPhone: phoneSetting(input.settings, "duty_manager_phone"), emergencyServicesPhone: phoneSetting(input.settings, "emergency_services_phone") },
  };
}
