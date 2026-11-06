import { dayStartInstant, addDays, type CalendarDate } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { BillRow, ComplaintRow, EntryRow, MembershipRow, SettingsRow, VisitorRow } from "./mapper";

/**
 * Every database read the resident Home makes, in one file. They are all SELECTs (the app role has no more than that on
 * these tables). The flat id passed to the functions below comes only from `findCurrentMemberships`, which reads the
 * signed-in person's own memberships; nothing here takes a flat from a request.
 */
const SETTING_KEYS = ["late_fee_policy", "duty_manager_phone", "emergency_services_phone"];

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

/** Open complaints of the flat (not closed), newest first. */
export async function loadOpenComplaints(db: Db, flatId: string): Promise<ComplaintRow[]> {
  return db.complaint.findMany({
    where: { flatId, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" },
    select: { body: true, status: true, createdAt: true, responseDueAt: true, firstResponseAt: true },
  });
}

/** Visitors of the flat expected on the India day `today`, not cancelled. */
export async function loadTodaysVisitors(db: Db, flatId: string, today: CalendarDate): Promise<VisitorRow[]> {
  return db.visitorPass.findMany({
    where: { flatId, status: { not: "CANCELLED" }, expectedAt: { gte: new Date(dayStartInstant(today)), lt: new Date(dayStartInstant(addDays(today, 1))) } },
    orderBy: { expectedAt: "asc" },
    select: { visitorName: true, expectedAt: true },
  });
}

export async function loadSettings(db: Db): Promise<SettingsRow[]> {
  const rows = await db.societySetting.findMany({ where: { key: { in: SETTING_KEYS } }, select: { key: true, value: true } });
  return rows;
}
