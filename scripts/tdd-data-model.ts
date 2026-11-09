// Prints a markdown table of every Prisma model: table name, scalar column count and relation count.
// Plain-text parsing of prisma/schema.prisma, no dependency.  Run: npm run tdd:data-model
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const modelNames = new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));

const rows: string[] = [];
for (const block of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = block;
  let table = "UNMAPPED";
  let columns = 0;
  let relations = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    const map = line.match(/^@@map\("([^"]+)"\)/);
    if (map) table = map[1];
    if (line.startsWith("@@")) continue;
    const field = line.match(/^(\w+)\s+(\w+)(\[\]|\?)?/);
    if (!field) continue;
    if (modelNames.has(field[2])) relations += 1;
    else columns += 1;
  }
  rows.push(`| ${name} | ${table} | ${columns} | ${relations} |`);
}

console.log("| Model | Table | Columns | Relations |");
console.log("|---|---|---|---|");
console.log(rows.join("\n"));
