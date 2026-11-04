import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";

/** Every row has a string key such as "flat:T12-0408"; the database writer maps keys to UUIDs. */
export type DemoFlat = { key: string; code: string; tower: string; number: string; areaSqft: number };

export type DemoUser = { key: string; phone: string; name: string; role: "RESIDENT" | "STAFF"; active: boolean };

export type DemoFlatMember = {
  flatKey: string;
  userKey: string;
  relation: "OWNER" | "TENANT" | "FAMILY";
  startsOn: CalendarDate;
  endsOn: CalendarDate | null;
};

export type DemoBill = {
  key: string;
  flatKey: string;
  period: CalendarDate;
  issuedOn: CalendarDate;
  dueOn: CalendarDate;
  amountPaise: Paise;
  areaSqftSnapshot: number;
  ratePaisePerSqft: number;
};

export type DemoLedgerEntry = {
  key: string;
  flatKey: string;
  entryType: "BILL" | "LATE_FEE" | "PAYMENT" | "REVERSAL" | "ADJUSTMENT";
  direction: "CHARGE" | "PAYMENT";
  amountPaise: Paise;
  effectiveDate: CalendarDate;
  billKey: string | null;
  reference: string | null;
  idempotencyKey: string;
  note: string | null;
};

export type DemoStaff = { userKey: string; permissions: string[] };

export type DemoDataset = {
  seed: number;
  asOf: CalendarDate;
  flats: DemoFlat[];
  users: DemoUser[];
  members: DemoFlatMember[];
  bills: DemoBill[];
  ledgerEntries: DemoLedgerEntry[];
  staff: DemoStaff[];
};

export const DEFAULT_SEED = 20261027;

/** The "today" of the demo: late fees and overdue days are worked out as of this date. */
export const DEMO_AS_OF: CalendarDate = "2026-10-27";

/** Billing periods (the first day of each month), oldest first. */
export const DEMO_PERIODS: readonly CalendarDate[] = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"];

export const RATE_PAISE_PER_SQFT = 650;

export const TOTAL_FLATS = 2400;
export const TOWER_COUNT = 28;
