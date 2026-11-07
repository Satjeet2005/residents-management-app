import type { Db } from "@/server/auth/db";
import { phoneSetting } from "@/server/home/mapper";
import { loadSettings } from "@/server/home/queries";
import { autoCloseQuietly } from "./auto-close";
import { type Actor, loadComplaintSettings } from "./context";
import { type OwnComplaint, type OwnComplaintLine, getComplaint, listOwnComplaints } from "./read";

/** What /complaints shows: open complaints first, closed ones apart. */
export type ComplaintListData = { kind: "NO_FLAT" } | { kind: "OK"; open: OwnComplaintLine[]; closed: OwnComplaintLine[] };

/**
 * The data of /complaints (T13b). Auto-close runs first, lazily (D120), so a complaint that has waited long enough shows as closed. The flat is the
 * resident's own current flat (`listOwnComplaints`); a request cannot name another. Any other failure throws, and the page's error state is shown.
 */
export async function loadComplaintList(input: { db: Db; user: Actor; now: number }): Promise<ComplaintListData> {
  await autoCloseQuietly({ db: input.db, now: input.now });
  const result = await listOwnComplaints(input);
  if (result.status === "ERROR") {
    if (result.error === "NO_FLAT") return { kind: "NO_FLAT" };
    throw new Error(`complaints list: ${result.error}`);
  }
  return { kind: "OK", open: result.complaints.filter((c) => c.status !== "CLOSED"), closed: result.complaints.filter((c) => c.status === "CLOSED") };
}

/** What the raise form needs: the duty manager's number from the settings (null when it is not set), for the call link shown after "Yes". */
export async function loadRaiseFormData(input: { db: Db }): Promise<{ dutyManagerPhone: string | null }> {
  return { dutyManagerPhone: phoneSetting(await loadSettings(input.db), "duty_manager_phone") };
}

/** What /complaints/[id] shows: the complaint and the number of days after which it closes by itself (the `auto_close_days` setting). */
export type ComplaintDetailData = { kind: "NO_FLAT" } | { kind: "NOT_FOUND" } | { kind: "OK"; complaint: OwnComplaint; autoCloseDays: number };

/**
 * The data of /complaints/[id]. A complaint of another flat, one that does not exist and an id that is not a UUID are all NOT_FOUND: the page cannot tell
 * them apart, so it cannot leak that another flat's complaint exists. Auto-close runs first, lazily (D120).
 */
export async function loadComplaintDetail(input: { db: Db; user: Actor; id: string; now: number }): Promise<ComplaintDetailData> {
  await autoCloseQuietly({ db: input.db, now: input.now });
  const result = await getComplaint(input);
  if (result.status === "ERROR") {
    if (result.error === "NO_FLAT") return { kind: "NO_FLAT" };
    if (result.error === "NOT_FOUND") return { kind: "NOT_FOUND" };
    throw new Error(`complaint detail: ${result.error}`);
  }
  return { kind: "OK", complaint: result.complaint, autoCloseDays: (await loadComplaintSettings(input.db)).lifecycle.autoCloseDays };
}
