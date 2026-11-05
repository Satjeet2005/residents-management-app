import type { Role } from "./policy";

export const PERMISSIONS = ["payments:match", "payments:approve", "reports:view", "complaints:manage", "complaints:duty_manager"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The one rule for what a person may do (D1). A resident never holds a permission, whatever the list
 * says. An inactive person holds none. Staff hold exactly the permissions listed for them; a string
 * that is not one of PERMISSIONS never matches.
 */
export function can(user: { role: Role; active: boolean; permissions: readonly string[] }, needed: Permission): boolean {
  if (!user.active) return false;
  if (user.role !== "STAFF") return false;
  return user.permissions.includes(needed);
}
