import { buildAppRoleSql } from "./app-role";

/**
 * `npm run db:print-app-role-sql -- --app=<role> --owner=<role>` prints the grants for the application role to stdout.
 * It connects to nothing, and it neither accepts nor prints a password. Any other argument is refused.
 */
function main(): void {
  const given = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--(app|owner)=(.*)$/.exec(arg);
    if (match === null) fail(`Unknown argument "${arg.split("=")[0]}". Use --app=<role> --owner=<role>. No password is accepted.`);
    if (given.has(match[1])) fail(`--${match[1]} was given twice.`);
    given.set(match[1], match[2]);
  }
  const appRole = given.get("app");
  const ownerRole = given.get("owner");
  if (appRole === undefined || ownerRole === undefined) fail("Usage: npm run db:print-app-role-sql -- --app=<role> --owner=<role>");
  try {
    process.stdout.write(buildAppRoleSql({ appRole, ownerRole }));
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not build the SQL.");
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();
