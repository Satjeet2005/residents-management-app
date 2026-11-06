import Link from "next/link";
import { CheckIcon, WarningIcon } from "@/components/icons";
import { formatDayYear } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import type { ImportListEntry } from "@/lib/reconciliation/types";

function Books({ accounted }: { accounted: boolean }) {
  return accounted ? (
    <span className="inline-flex items-center gap-1 text-body">
      <CheckIcon size={18} />
      {t("recon.imports.accounted")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-body font-semibold text-caution">
      <WarningIcon size={18} />
      {t("recon.imports.notAccounted")}
    </span>
  );
}

const link = "inline-flex min-h-12 items-center break-words text-body font-semibold text-accent underline underline-offset-4";

/** The recent imports: a real table from 768px, stacked cards below. Each links to its workspace. */
export function ImportsTable({ imports }: { imports: readonly ImportListEntry[] }) {
  if (imports.length === 0) return <p className="text-body text-ink-2">{t("recon.imports.empty")}</p>;
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-body">
          <caption className="sr-only">{t("recon.imports.caption")}</caption>
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="py-2 pr-4 font-semibold">{t("recon.col.date")}</th>
              <th scope="col" className="py-2 pr-4 font-semibold">{t("recon.col.file")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("recon.col.rows")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("recon.col.posted")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("recon.col.needsYou")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("recon.col.ignored")}</th>
              <th scope="col" className="py-2 font-semibold">{t("recon.col.books")}</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((entry) => (
              <tr key={entry.importId} className="border-b border-hairline">
                <td className="tnum py-1 pr-4">{formatDayYear(entry.uploadedOn)}</td>
                <td className="py-1 pr-4">
                  <Link href={workspaceHref({ importId: entry.importId, lane: "NEEDS_YOU" })} className={link}>
                    {entry.filename}
                  </Link>
                </td>
                <td className="tnum py-1 pr-4 text-right">{entry.rowsRead}</td>
                <td className="tnum py-1 pr-4 text-right">{entry.posted}</td>
                <td className="tnum py-1 pr-4 text-right">{entry.needsYou + entry.awaitingApproval}</td>
                <td className="tnum py-1 pr-4 text-right">{entry.ignored}</td>
                <td className="py-1">
                  <Books accounted={entry.accounted} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col md:hidden">
        {imports.map((entry) => (
          <li key={entry.importId} className="flex flex-col gap-1 border-b border-hairline py-3">
            <Link href={workspaceHref({ importId: entry.importId, lane: "NEEDS_YOU" })} className={link}>
              {entry.filename}
            </Link>
            <span className="tnum text-caption text-ink-2">{formatDayYear(entry.uploadedOn)}</span>
            <dl className="tnum grid grid-cols-2 gap-x-4 text-body">
              <dt className="text-ink-2">{t("recon.col.rows")}</dt>
              <dd className="text-right">{entry.rowsRead}</dd>
              <dt className="text-ink-2">{t("recon.col.posted")}</dt>
              <dd className="text-right">{entry.posted}</dd>
              <dt className="text-ink-2">{t("recon.col.needsYou")}</dt>
              <dd className="text-right">{entry.needsYou + entry.awaitingApproval}</dd>
              <dt className="text-ink-2">{t("recon.col.ignored")}</dt>
              <dd className="text-right">{entry.ignored}</dd>
            </dl>
            <Books accounted={entry.accounted} />
          </li>
        ))}
      </ul>
    </>
  );
}
