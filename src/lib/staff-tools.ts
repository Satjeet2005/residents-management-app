import { can } from "@/domain/auth/permissions";
import type { Role } from "@/domain/auth/policy";

export type StaffTool = { key: "reconciliation" | "complaints"; href: string };

/** The staff tools a person may open. A tool is listed only when its page exists AND the person holds the permission that page checks. */
export function staffToolsFor(user: { role: Role; active: boolean; permissions: readonly string[] }): StaffTool[] {
  const tools: StaffTool[] = [];
  if (can(user, "payments:match")) tools.push({ key: "reconciliation", href: "/staff/reconciliation" });
  if (can(user, "complaints:manage")) tools.push({ key: "complaints", href: "/staff/complaints" });
  return tools;
}
