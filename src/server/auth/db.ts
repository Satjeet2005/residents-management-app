import type { Prisma, PrismaClient } from "../../../generated/prisma/client";

/** The database handle the auth services use: a client, or the client inside a transaction. */
export type Db = PrismaClient;
export type DbOrTx = PrismaClient | Prisma.TransactionClient;
