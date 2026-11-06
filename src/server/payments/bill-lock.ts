import type { Prisma } from "../../../generated/prisma/client";

/**
 * Takes the lock that stands for one bill until the transaction ends: `pg_advisory_xact_lock(hashtext(<bill id>))`.
 * A payment can reach a bill from two sides, the gateway's webhook and a bank statement, and each must read the bill's payments
 * AFTER taking this lock and write its entries before releasing it (commit or rollback), so the second one sees the first one's
 * payment and cannot pay the same bill again (D104). Both sides call this one function, so they cannot use different keys.
 * Two bills whose ids hash alike only wait for each other; that costs a little time, never a wrong answer.
 */
export async function lockBill(tx: Prisma.TransactionClient, billId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${billId}))`;
}
