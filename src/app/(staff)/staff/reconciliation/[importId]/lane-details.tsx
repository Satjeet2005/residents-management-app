import { formatDay } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { entryLabel, ignoreKindLabel, postedByLabel, requestActionLabel } from "@/lib/reconciliation/labels";
import { type Viewer, approvalView } from "@/lib/reconciliation/permission-view";
import type { RowCard } from "@/lib/reconciliation/types";
import { ApprovalControls } from "./approval-controls";

/** A row that awaits a second approver: who asked, for what, why and when, then Approve and Reject or "Waiting for another approver". */
export function AwaitingDetails({ row, viewer }: { row: RowCard; viewer: Viewer }) {
  const request = row.request;
  if (request === null) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body font-semibold">{requestActionLabel(request.action, request.flatCode)}</p>
      <p className="text-body">{t("recon.awaiting.askedBy", { name: request.requestedBy, date: formatDay(request.requestedOn) })}</p>
      <p className="break-words text-body">{t("recon.awaiting.reason", { reason: request.reason })}</p>
      {approvalView(viewer, request.requestedById) === "ACTIONS" ? <ApprovalControls rowId={row.id} /> : <p className="text-body font-semibold">{t("recon.awaiting.waiting")}</p>}
    </div>
  );
}

/** A posted row, read only: the flat, who posted it ("Automatic" or "Manual by <name>") and the entries it made. There is no undo. */
export function PostedDetails({ row }: { row: RowCard }) {
  const posted = row.posted;
  if (posted === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="tnum text-body font-semibold">{t("recon.posted.flat", { flat: posted.flatCode })}</p>
      <p className="text-body">{postedByLabel(posted.by)}</p>
      {posted.entries.length > 0 && (
        <ul className="tnum flex flex-col text-body">
          {posted.entries.map((entry, index) => (
            <li key={index}>{entryLabel(entry)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A row set aside as not maintenance, read only: the kind the matcher found, or the reason a person gave. */
export function IgnoredDetails({ row }: { row: RowCard }) {
  const ignored = row.ignored;
  if (ignored === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-semibold">{ignoreKindLabel(ignored.ignoreKind)}</p>
      {ignored.reason !== null && <p className="break-words text-body">{t("recon.ignored.reason", { reason: ignored.reason })}</p>}
    </div>
  );
}
