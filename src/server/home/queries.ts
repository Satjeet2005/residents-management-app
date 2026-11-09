import type { CalendarDate } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { AttemptRow, BillRow, ComplaintRow, EntryRow, MembershipRow, SettingsRow } from "./mapper";

/**
 * Every database read the resident Home makes, in one file. They are all SELECTs (the app role has no more than that on
 * these tables). The flat id passed to the functions below comes only from `findCurrentMemberships`, which reads the
 * signed-in person's own memberships; nothing here takes a flat from a request.
 */
const SETTING_KEYS = ["late_fee_policy", "duty_manager_phone", "emergency_services_phone", "society_bank_account", "safety_ack_timeout_minutes"];

/** The person's memberships that are current on `today`: started, and not ended before today. */
export async function findCurrentMemberships(db: Db, userId: string, today: CalendarDate): Promise<MembershipRow[]> {
  const day = new Date(`${today}T00:00:00.000Z`);
  const rows = await db.flatMember.findMany({
    where: { userId, startsOn: { lte: day }, OR: [{ endsOn: null }, { endsOn: { gte: day } }] },
    select: { flatId: true, relation: true, flat: { select: { code: true } } },
  });
  return rows.map((r) => ({ flatId: r.flatId, flatCode: r.flat.code, relation: r.relation }));
}

export async function loadBills(db: Db, flatId: string): Promise<BillRow[]> {
  const rows = await db.bill.findMany({ where: { flatId }, select: { id: true, period: true, issuedOn: true, dueOn: true, amountPaise: true } });
  return rows;
}

export async function loadEntries(db: Db, flatId: string): Promise<EntryRow[]> {
  return db.ledgerEntry.findMany({
    where: { flatId },
    select: { id: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true, createdAt: true },
  });
}

/**
 * Open complaints of the flat (not closed), newest first. `acknowledgedAt` is the time of the first acknowledgement event (a COMMENT with the kind "ack",
 * written only by the duty manager's acknowledge action, D149), never `first_response_at`, which any staff action sets.
 */
export async function loadOpenComplaints(db: Db, flatId: string): Promise<ComplaintRow[]> {
  const rows = await db.complaint.findMany({
    where: { flatId, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, safetyFlag: true, body: true, status: true, createdAt: true, responseDueAt: true, firstResponseAt: true,
      events: { where: { eventType: "COMMENT", payload: { path: ["kind"], equals: "ack" } }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
    },
  });
  return rows.map(({ events, ...row }) => ({ ...row, acknowledgedAt: events[0]?.createdAt ?? null }));
}

export async function loadSettings(db: Db): Promise<SettingsRow[]> {
  const rows = await db.societySetting.findMany({ where: { key: { in: SETTING_KEYS } }, select: { key: true, value: true } });
  return rows;
}

/** The newest payment attempt of the flat (by start time), or null: all the Home needs to know about attempts. */
export async function loadLatestAttempt(db: Db, flatId: string): Promise<AttemptRow | null> {
  return db.paymentAttempt.findFirst({ where: { flatId }, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true } });
}
