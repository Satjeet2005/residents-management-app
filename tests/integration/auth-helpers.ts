import { PrismaPg } from "@prisma/adapter-pg";
import { randomInt } from "node:crypto";
import { inject, vi } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";

export const T0 = Date.UTC(2026, 10, 6, 4, 0, 0);
export const TEST_PEPPER = "integration-test-pepper-0123456789abcdef";

export function newPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject("testDatabaseUrl") }) });
}

/** Pepper and demo mode are set for every test; a test that needs another value stubs it again. */
export function useAuthEnv(demoMode = "false"): void {
  vi.stubEnv("OTP_PEPPER", TEST_PEPPER);
  vi.stubEnv("DEMO_MODE", demoMode);
  vi.stubEnv("NODE_ENV", "test");
}

/** A phone that has not been used in this run. `first` is the leading digit: 5 is a demo phone. */
export const freshPhone = (first = 9): string => `${first}${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
let ipCounter = randomInt(0, 60_000);
/** An address not used before in this run: a counter, so two tests never share an address by chance. */
export const freshIp = (): string => `198.51.${Math.floor(++ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;

export async function makeUser(
  prisma: PrismaClient,
  options: { role?: "RESIDENT" | "STAFF"; active?: boolean; permissions?: string[]; phone?: string; name?: string } = {},
) {
  const phone = options.phone ?? freshPhone();
  const user = await prisma.user.create({
    data: {
      phone,
      name: options.name ?? "Test Person",
      role: options.role ?? "RESIDENT",
      active: options.active ?? true,
      permissions: { create: (options.permissions ?? []).map((permission) => ({ permission })) },
    },
  });
  return { id: user.id, phone };
}

/** 16 bytes whose first word is `code` (a number below 4,294,000,000): otpFromRandom then returns it as the code. */
export function bytesForCode(code: number): Uint8Array {
  const out = new Uint8Array(16);
  out[0] = (code >>> 24) & 255;
  out[1] = (code >>> 16) & 255;
  out[2] = (code >>> 8) & 255;
  out[3] = code & 255;
  return out;
}

/** A byte source that gives these codes in order, one per request. */
export function codesInOrder(...codes: number[]): (n: number) => Uint8Array {
  let next = 0;
  return () => bytesForCode(codes[Math.min(next++, codes.length - 1)]);
}

export const sixDigits = (code: number): string => String(code).padStart(6, "0");

/** Every row of the tables, as text, for scans that look for a secret anywhere. */
export async function dumpTables(prisma: PrismaClient, tables = ["otp_codes", "audit_log", "sessions"]): Promise<string> {
  const parts: string[] = [];
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<{ row: string }[]>(`SELECT row_to_json(t)::text AS row FROM ${table} t`);
    parts.push(...rows.map((r) => r.row));
  }
  return parts.join("\n");
}

let flatCounter = 0;
/** A flat with a code that sorts predictably: `Z<run>-<n>` unless a code is given. */
export async function makeFlat(prisma: PrismaClient, code?: string): Promise<{ id: string; code: string }> {
  const flatCode = code ?? `Z${String(randomInt(0, 1e9)).padStart(9, "0")}-${++flatCounter}`;
  const flat = await prisma.flat.create({ data: { code: flatCode, tower: "T1", number: String(flatCounter), areaSqft: 1000 } });
  return { id: flat.id, code: flat.code };
}

/** A membership from `startsOn` to `endsOn` (both `YYYY-MM-DD`; `endsOn` null means no end). */
export async function addMember(prisma: PrismaClient, flatId: string, userId: string, startsOn: string, endsOn: string | null = null): Promise<void> {
  await prisma.flatMember.create({
    data: { flatId, userId, relation: "OWNER", startsOn: new Date(`${startsOn}T00:00:00Z`), endsOn: endsOn === null ? null : new Date(`${endsOn}T00:00:00Z`) },
  });
}
