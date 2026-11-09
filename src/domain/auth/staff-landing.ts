const OTHER_TOOLS = ["complaints:manage", "payments:match", "payments:approve", "complaints:duty_manager"] as const;

/**
 * True for a staff member whose only tool is the committee report (D236): they land on the report overview, and the staff home would be a detour.
 * Anyone who also holds another tool keeps the staff home.
 */
export function landsOnReport(permissions: readonly string[]): boolean {
  return permissions.includes("reports:view") && !OTHER_TOOLS.some((permission) => permissions.includes(permission));
}
