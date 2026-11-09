// A HUMAN-run proof that the classifier providers work through the REAL service, not through HTTP:  npm run jev:e2e
// It creates the scratch database township_seed_scratch (e2e-db.mjs prints SELECT current_database() and refuses any other name), migrates and seeds it, then raises
// eight complaints as the seeded resident Swati Joshi through `createComplaint` (the service the API route calls) with `productionClassifier()` built from the real
// environment, and prints one line per complaint. A counting wrapper around the global fetch records ONLY how many requests were made. It never prints a key, a
// URL, a header or a body, asserts the safety rules (no provider is called for a safety word or a declared danger), and drops the database.
// It loads .env itself (never displayed). Exit code 1 when an assertion fails.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CASES = [
  { id: "a", language: "English", note: "plumbing", text: "Water is leaking from the ceiling of my living room.", danger: false },
  { id: "b", language: "English", note: "electrical", text: "The tube light in the 2nd floor passage is not working.", danger: false },
  { id: "c", language: "Hinglish", note: "lift", text: "Lift mein problem hai, bar bar ruk jati hai, please check karo.", danger: false },
  { id: "d", language: "Hindi", note: "housekeeping", text: "सीढ़ियों पर कचरा पड़ा है, कृपया सफाई करवाइए।", danger: false },
  { id: "e", language: "Marathi", note: "plumbing", text: "बाथरूममधील नळातून पाणी गळत आहे, कृपया दुरुस्त करा.", danger: false },
  { id: "f", language: "English", note: "other", text: "Cars are parked in the visitor slots all day.", danger: false },
  { id: "g", language: "English", note: "safety word", text: "I can smell gas near the lift lobby.", danger: false },
  { id: "h", language: "English", note: "declared danger", text: "Please send someone.", danger: true },
] as const;

const exampleUrl = (): string => {
  const line = readFileSync(".env.example", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (line === undefined) throw new Error("DATABASE_URL is not in .env.example");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
};

const run = (command: string, args: string[], env: Record<string, string | undefined>): void => {
  execFileSync(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
};

async function main(): Promise<number> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env: the variables may come from the shell.
  }
  const configured = ["JEV_PRIMARY_KEY", "JEV_SECONDARY_KEY"].some((name) => (process.env[name] ?? "") !== "");

  const base = new URL(exampleUrl());
  const scratch = new URL(base);
  scratch.pathname = "/township_seed_scratch";
  const adminEnv = { DATABASE_URL: base.toString() };
  const scratchEnv = { DATABASE_URL: scratch.toString(), DEMO_MODE: "true", DEMO_AS_OF: "2026-10-27", IGNORE_DOTENV: "true" };

  console.log("== scratch database ==");
  console.log(execFileSync("node", ["scripts/e2e-db.mjs", "drop"], { env: { ...process.env, ...adminEnv } }).toString().trim());
  console.log(execFileSync("node", ["scripts/e2e-db.mjs", "create"], { env: { ...process.env, ...adminEnv } }).toString().trim());
  let failed = 0;
  try {
    run("npx", ["prisma", "migrate", "deploy"], scratchEnv);
    run("npm", ["run", "db:seed", "--", "--yes"], scratchEnv);
    process.env.DATABASE_URL = scratch.toString();
    process.env.DEMO_MODE = "true";
    process.env.DEMO_AS_OF = "2026-10-27";

    let requests = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests += 1;
      return realFetch(input, init);
    }) as typeof fetch;

    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("../generated/prisma/client");
    const { createComplaint } = await import("../src/server/complaints/create");
    const { productionClassifier } = await import("../src/server/complaints/providers/factory");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratch.toString() }) });
    try {
      const current = await db.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
      console.log(`current_database: ${current[0].current_database}`);
      if (current[0].current_database !== "township_seed_scratch") throw new Error("not the scratch database");
      const swati = await db.user.findFirstOrThrow({ where: { name: "Swati Joshi" } });
      const actor = { id: swati.id, name: swati.name, role: "RESIDENT" as const, active: true, permissions: [] as string[] };
      const classifier = productionClassifier();
      const now = Date.UTC(2026, 9, 27, 6, 30, 0);

      console.log("== eight complaints as Swati Joshi, through createComplaint ==");
      console.log("id  language  source    category      urgency   conf  review  requests  ms");
      const rows: { id: string; source: string; urgency: string; requests: number }[] = [];
      for (const [index, item] of CASES.entries()) {
        const before = requests;
        const started = Date.now();
        const result = await createComplaint({ db, user: actor, body: item.text, now: now + index * 120_000, classifier, declaredDanger: item.danger });
        const ms = Date.now() - started;
        const delta = requests - before;
        if (result.status !== "OK") throw new Error(`complaint ${item.id}: ${result.status}`);
        const row = await db.classification.findFirst({ where: { complaintId: result.complaint.id }, include: { category: true } });
        const source = row?.source ?? "NONE";
        console.log(`${item.id}   ${item.language.padEnd(8)}  ${source.padEnd(8)}  ${(row?.category?.code ?? "-").padEnd(12)}  ${result.complaint.urgency.padEnd(8)}  ${row?.confidence === null || row?.confidence === undefined ? "-   " : Number(row.confidence).toFixed(2)}  ${String(result.complaint.needsReview).padEnd(6)}  ${String(delta).padEnd(8)}  ${ms}`);
        rows.push({ id: item.id, source, urgency: result.complaint.urgency, requests: delta });
      }

      const check = (ok: boolean, what: string): void => {
        console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
        if (!ok) failed += 1;
      };
      for (const id of ["g", "h"]) {
        const row = rows.find((r) => r.id === id);
        check(row?.source === "RULE" && row.urgency === "CRITICAL" && row.requests === 0, `${id}: source RULE, urgency CRITICAL, zero provider requests`);
      }
      for (const row of rows.filter((r) => !["g", "h"].includes(r.id))) {
        check(row.requests <= (configured ? 2 : 0), `${row.id}: at most ${configured ? "two attempts (one per provider)" : "no"} provider request (${row.requests}); source ${row.source}`);
      }
      console.log(`provider requests in total: ${requests}`);
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${error instanceof Error ? error.constructor.name : "error"}: ${error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 200) : "unknown"}`);
  } finally {
    console.log("== drop the scratch database ==");
    console.log(execFileSync("node", ["scripts/e2e-db.mjs", "drop"], { env: { ...process.env, ...adminEnv } }).toString().trim());
    const { Client } = await import("pg");
    const client = new Client({ connectionString: new URL("/postgres", base).toString() });
    await client.connect();
    const left = await client.query("SELECT datname FROM pg_database WHERE datname LIKE 'township_%' ORDER BY 1");
    await client.end();
    console.log(`databases named township_*: ${left.rows.map((r: { datname: string }) => r.datname).join(", ")}`);
  }
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
