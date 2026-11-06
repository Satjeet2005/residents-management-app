import { PrismaPg } from "@prisma/adapter-pg";
import { dbPoolOptions } from "./db-options";
import { PrismaClient } from "../../generated/prisma/client";

const globalForDb = globalThis as unknown as { townshipDb?: PrismaClient };

/** The one database client of the running server. It is created at first use, so a build never needs DATABASE_URL. */
export function getDb(): PrismaClient {
  if (globalForDb.townshipDb === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForDb.townshipDb = new PrismaClient({ adapter: new PrismaPg({ connectionString, ...dbPoolOptions(process.env) }) });
  }
  return globalForDb.townshipDb;
}
