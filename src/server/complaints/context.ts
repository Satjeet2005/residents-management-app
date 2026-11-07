import { z } from "zod";
import { can } from "@/domain/auth/permissions";
import { type LifecycleSettings, type SlaMinutes, defaultLifecycleSettings, defaultSlaMinutes } from "@/domain/complaints/lifecycle";
import { istDateOf } from "@/domain/time/calendar";
import type { Db, DbOrTx } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { findCurrentMemberships } from "@/server/home/queries";
import type { Prisma } from "../../../generated/prisma/client";

export type Tx = Prisma.TransactionClient;

/** Who is acting. The route already checked the permission; every service call checks it again (a second lock on the same door). */
export type Actor = Pick<SessionUser, "id" | "name" | "role" | "active" | "permissions">;

export const isResident = (user: Actor): boolean => user.role === "RESIDENT" && user.active;
export const canManage = (user: Actor): boolean => can(user, "complaints:manage");
export const isDutyManager = (user: Actor): boolean => can(user, "complaints:duty_manager");

/**
 * The flat a resident raises and reads complaints for: the same rule as the Home (src/server/home/home-data.ts), the first current membership by
 * flat code. Nothing here takes a flat from a request.
 */
export async function currentFlat(db: Db, userId: string, now: number): Promise<{ flatId: string; flatCode: string } | null> {
  const memberships = (await findCurrentMemberships(db, userId, istDateOf(now))).sort((a, b) => (a.flatCode < b.flatCode ? -1 : a.flatCode > b.flatCode ? 1 : 0));
  const first = memberships[0];
  return first === undefined ? null : { flatId: first.flatId, flatCode: first.flatCode };
}

export type ComplaintSettings = { slaMinutes: SlaMinutes; lifecycle: LifecycleSettings };

const slaSchema = z.object({ CRITICAL: z.number().int().positive(), HIGH: z.number().int().positive(), NORMAL: z.number().int().positive(), LOW: z.number().int().positive() });
const daysSchema = z.number().int().positive().max(365);

/** The `sla_minutes` and `auto_close_days` settings. A missing or invalid value falls back to the documented default (15 / 120 / 1,440 / 4,320 minutes, 7 days). */
export async function loadComplaintSettings(db: DbOrTx): Promise<ComplaintSettings> {
  const rows = await db.societySetting.findMany({ where: { key: { in: ["sla_minutes", "auto_close_days"] } }, select: { key: true, value: true } });
  const value = (key: string): unknown => rows.find((r) => r.key === key)?.value;
  const sla = slaSchema.safeParse(value("sla_minutes"));
  const days = daysSchema.safeParse(value("auto_close_days"));
  return {
    slaMinutes: sla.success ? sla.data : defaultSlaMinutes,
    lifecycle: { ...defaultLifecycleSettings, autoCloseDays: days.success ? days.data : defaultLifecycleSettings.autoCloseDays },
  };
}
