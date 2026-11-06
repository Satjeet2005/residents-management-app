import { can } from "@/domain/auth/permissions";
import type { Role } from "@/domain/auth/policy";

export type Viewer = { id: string; role: Role; active: boolean; permissions: readonly string[] };

/**
 * What a person sees on a row that awaits approval: Approve and Reject only for someone who holds payments:approve and is NOT
 * the person who asked (D14, D108). The requester, and everyone else, sees "Waiting for another approver" and no buttons. The
 * server checks the same rules again (SELF_APPROVAL, FORBIDDEN); this only decides what to draw.
 */
export function approvalView(viewer: Viewer, requestedById: string): "ACTIONS" | "WAITING" {
  return can(viewer, "payments:approve") && viewer.id !== requestedById ? "ACTIONS" : "WAITING";
}
