// The scratch database of `npm run e2e`:  node scripts/e2e-db.mjs create | drop
// It only ever touches the database named township_seed_scratch (CLAUDE.md, "Project Safety Rules"), prints SELECT current_database() first, and stops if the name
// is anything else. The server is the same local one as DATABASE_URL (the value of .env.example unless DATABASE_URL is set), never a remote or hosted one.
import pg from "pg";

const NAME = "township_seed_scratch";
const base = new URL(process.env.DATABASE_URL ?? "");
if (base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
  console.error("e2e: refusing to use a database that is not on localhost.");
  process.exit(1);
}
const at = (name) => {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
};

async function currentDatabase(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query("SELECT current_database()")).rows[0].current_database;
  } finally {
    await client.end();
  }
}

async function admin(run) {
  const client = new pg.Client({ connectionString: at("postgres") });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

const command = process.argv[2];
try {
  if (command === "create") {
    await admin(async (client) => {
      const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [NAME]);
      if (found.rowCount === 0) await client.query(`CREATE DATABASE ${NAME}`);
    });
    const name = await currentDatabase(at(NAME));
    console.log(`current_database: ${name}`);
    if (name !== NAME) process.exit(1);
  } else if (command === "drop") {
    const name = await currentDatabase(at(NAME)).catch(() => null);
    if (name === null) {
      console.log(`${NAME} does not exist; nothing to drop.`);
    } else {
      console.log(`current_database: ${name}`);
      if (name !== NAME) process.exit(1);
      await admin((client) => client.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`));
      console.log(`dropped ${NAME}`);
    }
  } else {
    console.error("usage: node scripts/e2e-db.mjs create | drop");
    process.exit(2);
  }
} catch (error) {
  console.error(`e2e-db: ${error instanceof Error ? error.message : "failed"}`);
  process.exit(1);
}
