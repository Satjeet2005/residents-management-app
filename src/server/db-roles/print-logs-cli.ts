import { buildLogsRoleSql } from "./logs-role";

/**
 * `npm run db:print-logs-role-sql -- --role=<name> --owner=<name>` prints the grants for the read-only logs role to stdout. It connects to nothing,
 * and it neither accepts nor prints a password. Any other argument is refused.
 */
function main(): void {
  const given = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--(role|owner)=(.*)$/.exec(arg);
    if (match === null) fail(`Unknown argument "${arg.split("=")[0]}". Use --role=<name> --owner=<name>. No password is accepted.`);
    if (given.has(match[1])) fail(`--${match[1]} was given twice.`);
    given.set(match[1], match[2]);
  }
  const logsRole = given.get("role");
  const ownerRole = given.get("owner");
  if (logsRole === undefined || ownerRole === undefined) fail("Usage: npm run db:print-logs-role-sql -- --role=<name> --owner=<name>");
  try {
    process.stdout.write(buildLogsRoleSql({ logsRole, ownerRole }));
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not build the SQL.");
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();
