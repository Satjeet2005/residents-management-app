import type { Db } from "@/server/auth/db";
import { phoneSetting } from "@/server/home/mapper";
import { loadSettings } from "@/server/home/queries";
import { autoCloseQuietly } from "./auto-close";
import type { Actor } from "./context";
import { type OwnComplaintLine, listOwnComplaints } from "./read";

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
