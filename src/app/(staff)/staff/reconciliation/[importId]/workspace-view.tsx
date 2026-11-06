import Link from "next/link";
import { formatDayYear } from "@/lib/format-date";
import { t } from "@/lib/messages";
import type { Lane } from "@/lib/reconciliation/types";
import type { Workspace } from "@/server/statements/ui-data";
import { LaneTabs } from "./lane-tabs";
import { RowList } from "./row-list";
import { SummaryBar } from "./summary-bar";

/** The workspace of one import: header, summary bar, lane tabs and the rows of the chosen lane. */
export function WorkspaceView({ data, lane }: { data: Workspace; lane: Lane }) {
  const { header, counts, laneCounts } = data;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <Link href="/staff/reconciliation" className="inline-flex min-h-12 items-center self-start text-body font-semibold text-accent underline underline-offset-4">
          {t("recon.ws.back")}
        </Link>
        <h1 className="break-words text-heading font-semibold">{header.filename}</h1>
        <p className="tnum text-body text-ink-2">{t("recon.ws.imported", { date: formatDayYear(header.uploadedOn), name: header.uploadedBy })}</p>
      </div>
      <SummaryBar counts={counts} />
      <LaneTabs importId={header.importId} lane={lane} laneCounts={laneCounts} />
      <RowList key={lane} importId={header.importId} lane={lane} initialRows={data.rows} initialCursor={data.nextCursor} />
    </main>
  );
}
