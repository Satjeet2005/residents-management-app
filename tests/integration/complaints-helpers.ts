import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { inject } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import type { ArmResult, ClassifierInput } from "@/domain/complaints/decision";
import { CATEGORY_CODES, type CategoryCode, MODEL_URGENCIES, type ModelUrgency } from "@/domain/complaints/taxonomy";
import { type Classifier } from "@/server/complaints/classifier";
import type { Actor } from "@/server/complaints/context";
import { dbPoolOptions } from "@/server/db-options";
import { connect } from "./db";
import { createAppRole, type TestAppRole } from "./app-role-helpers";
import { addMember, makeFlat, makeUser } from "./auth-helpers";

/** 6 Nov 2026, 12:00 India time. */
export const NOW = Date.UTC(2026, 10, 6, 6, 30, 0);
export const DAY = 86_400_000;

/** A well-formed answer of the classifier: the chosen category and urgency with their probabilities, the rest sharing what is left. */
export function arm(category: CategoryCode, categoryP = 0.9, urgency: ModelUrgency = "NORMAL", urgencyP = 0.9): ArmResult {
  const others = CATEGORY_CODES.filter((c) => c !== category);
  const otherUrgencies = MODEL_URGENCIES.filter((u) => u !== urgency);
  return {
    arm: "DIRECT",
    categories: [{ label: category, probability: categoryP }, ...others.map((label) => ({ label, probability: (1 - categoryP) / others.length }))],
    urgencies: [{ label: urgency, probability: urgencyP }, ...otherUrgencies.map((label) => ({ label, probability: (1 - urgencyP) / otherUrgencies.length }))],
  };
}

export type FakeBehaviour = { result?: ArmResult | null; throws?: boolean; delayMs?: number; invalid?: unknown };

/** A configurable classifier for tests: it records every input it is given and the signal state, and answers, fails or is slow as told. */
export class FakeClassifier implements Classifier {
  readonly inputs: ClassifierInput[] = [];
  aborted = false;
  constructor(public behaviour: FakeBehaviour = {}) {}
  get calls(): number {
    return this.inputs.length;
  }
  async classify(input: ClassifierInput, options?: { signal?: AbortSignal }): Promise<ArmResult | null> {
    this.inputs.push(input);
    options?.signal?.addEventListener("abort", () => {
      this.aborted = true;
    });
    if (this.behaviour.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, this.behaviour.delayMs));
    if (this.behaviour.throws) throw new Error("the model is down");
    if (this.behaviour.invalid !== undefined) return this.behaviour.invalid as ArmResult;
    return this.behaviour.result ?? null;
  }
}

export type World = {
  ownerPrisma: PrismaClient;
  /** The prisma client the services use: it logs in as the APP role, not the owner. */
  appPrisma: PrismaClient;
  role: TestAppRole;
  /** The scratch database: only a `township_test_*` database is ever created or dropped. */
  databaseName: string;
  databaseUrl: string;
  staff: { kavita: Actor; sanjay: Actor; priya: Actor };
  close: () => Promise<void>;
};

export async function actorOf(prisma: PrismaClient, id: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, role: true, active: true, permissions: { select: { permission: true } } } });
  return { id: user.id, name: user.name, role: user.role, active: user.active, permissions: user.permissions.map((p) => p.permission) };
}

/**
 * A scratch database (named `township_test_cl_<hex>`, its name printed by SELECT current_database() and checked before anything is written), the
 * five complaint categories, three staff (Kavita Rao: manage and the default assignee; Sanjay Pawar: manage and duty manager; Priya Nair: accounts,
 * no complaint permission), and the app role. Every service call in the tests goes through the app role.
 */
export async function setupWorld(): Promise<World> {
  const admin = await connect();
  const databaseName = `township_test_cl_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(inject("testDatabaseUrl"));
  url.pathname = `/${databaseName}`;
  const databaseUrl = url.toString();
  const dropAndEnd = async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  };
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    const owner = new Client({ connectionString: databaseUrl });
    await owner.connect();
    const current = (await owner.query<{ current_database: string }>("SELECT current_database()")).rows[0].current_database;
    if (!/^township_test_/.test(current)) throw new Error(`refusing to continue on database ${current}`);
    const role = await createAppRole(owner, databaseUrl);
    await owner.end();
    const ownerPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const appPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: role.url, ...dbPoolOptions({ DB_POOL_MAX: "6" }) }) });

    const kavita = await makeUser(ownerPrisma, { role: "STAFF", name: "Kavita Rao", permissions: ["complaints:manage"] });
    const sanjay = await makeUser(ownerPrisma, { role: "STAFF", name: "Sanjay Pawar", permissions: ["complaints:manage", "complaints:duty_manager"] });
    const priya = await makeUser(ownerPrisma, { role: "STAFF", name: "Priya Nair", permissions: ["payments:match"] });
    for (const code of CATEGORY_CODES) await ownerPrisma.complaintCategory.create({ data: { code, name: code, defaultAssigneeId: kavita.id } });
    await ownerPrisma.societySetting.createMany({
      data: [
        { key: "sla_minutes", value: { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 } },
        { key: "auto_close_days", value: 7 },
      ],
    });
    return {
      ownerPrisma,
      appPrisma,
      role,
      databaseName,
      databaseUrl,
      staff: { kavita: await actorOf(ownerPrisma, kavita.id), sanjay: await actorOf(ownerPrisma, sanjay.id), priya: await actorOf(ownerPrisma, priya.id) },
      close: async () => {
        await appPrisma.$disconnect();
        await ownerPrisma.$disconnect();
        await dropAndEnd();
        await role.drop();
      },
    };
  } catch (error) {
    await dropAndEnd();
    throw error;
  }
}

/** A resident with a current membership of a new flat. `name` is the resident's name, a fictional one. */
export async function makeResident(world: World, name = "Swati Joshi", flatCode?: string): Promise<{ user: Actor; flat: { id: string; code: string } }> {
  const flat = await makeFlat(world.ownerPrisma, flatCode);
  const user = await makeUser(world.ownerPrisma, { role: "RESIDENT", name });
  await addMember(world.ownerPrisma, flat.id, user.id, "2026-01-01");
  return { user: await actorOf(world.ownerPrisma, user.id), flat };
}

/** The saved complaint with everything a test reads about it. */
export async function loadComplaint(world: World, id: string) {
  return world.ownerPrisma.complaint.findUniqueOrThrow({
    where: { id },
    include: { category: { select: { code: true } }, events: { orderBy: { createdAt: "asc" } }, classifications: true },
  });
}
