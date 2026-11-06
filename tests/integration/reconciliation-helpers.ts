import type { ActingUser } from "@/server/statements/manual-core";
import { DEMO_NOW } from "@/domain/seed/types";
import { importStatement } from "@/server/statements/import";
import { makeUser } from "./auth-helpers";
import type { PaymentsFixture } from "./payments-fixture";
import { csv, nextReference } from "./statements-helpers";

const rupees = (paise: bigint): string => `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;

/** A staff user as the service sees them, read from the database: Priya (payments:match) and Rahul (match and approve) of the seed. */
export async function seedStaff(fx: PaymentsFixture, phone: string): Promise<ActingUser> {
  const user = await fx.owner.user.findUniqueOrThrow({ where: { phone }, select: { id: true, role: true, active: true, permissions: { select: { permission: true } } } });
  return { id: user.id, role: user.role, active: user.active, permissions: user.permissions.map((p) => p.permission) };
}

/** A new staff user with exactly these permissions. */
export async function newStaff(fx: PaymentsFixture, permissions: string[]): Promise<ActingUser> {
  const { id } = await makeUser(fx.owner, { role: "STAFF", permissions, name: "Test Staff" });
  return { id, role: "STAFF", active: true, permissions };
}

/** A credit line with no flat code and no name: the matcher queues it for a person. `vpa` adds a UPI address to the narration. */
export function anonymousCredit(amountPaise: bigint, options: { date?: string; vpa?: string } = {}): string {
  const who = options.vpa ?? "PAYMENT FOR FLAT MAINTENANCE";
  return `${options.date ?? "2026-10-27"},UPI/${nextReference()}/${who}/maint,${rupees(amountPaise)},`;
}

/** Imports one statement and returns its rows, in file order, with the staff user who uploaded it. */
export async function importLines(fx: PaymentsFixture, uploaderPhone: string, ...lines: string[]) {
  const uploader = await seedStaff(fx, uploaderPhone);
  const result = await importStatement({ db: fx.app, user: { id: uploader.id }, filename: "manual.csv", csvText: csv(...lines), now: DEMO_NOW });
  if (result.status !== "IMPORTED") throw new Error(result.status);
  const rows = await fx.owner.bankRow.findMany({ where: { importId: result.importId }, orderBy: { rowNumber: "asc" } });
  return { importId: result.importId, rows };
}

/** One QUEUED row for an anonymous credit. */
export async function queuedRow(fx: PaymentsFixture, amountPaise: bigint, options: { date?: string; vpa?: string } = {}) {
  const { rows } = await importLines(fx, "5000000001", anonymousCredit(amountPaise, options));
  if (rows[0].state !== "QUEUED") throw new Error(`expected QUEUED, got ${rows[0].state}`);
  return rows[0];
}
