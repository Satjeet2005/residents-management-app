import Link from "next/link";
import { CheckIcon, ChevronIcon } from "@/components/icons";
import { Notice } from "@/components/ui/notice";
import { formatDayYear } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { accountedLine } from "@/lib/reconciliation/summary";
import type { SummaryCounts, WorkspaceHeader as Header } from "@/lib/reconciliation/types";

const CRUMB = "inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4";

/**
 * The head of the workspace (D189): one breadcrumb line, the title, one secondary line (the file, when and by whom) and the accounted line. The line says
 * "All N rows accounted for" with a check ONLY when the flag read back from the database is true; otherwise a caution says not to post from this import.
 */
export function WorkspaceHeader({ header, counts }: { header: Header; counts: SummaryCounts }) {
  const line = accountedLine(counts);
  return (
    <div className="flex flex-col gap-1">
      <nav aria-label={t("recon.ws.crumbs")} className="flex flex-wrap items-center gap-1">
        <Link href="/staff" className={CRUMB}>
          {t("staff.nav.home")}
        </Link>
        <ChevronIcon size={16} />
        <Link href="/staff/reconciliation" className={CRUMB}>
          {t("recon.ws.back")}
        </Link>
      </nav>
      <h1 className="text-heading font-semibold">{t("recon.ws.title")}</h1>
      <p className="tnum break-words text-body text-ink-2">{t("recon.ws.meta", { file: header.filename, date: formatDayYear(header.uploadedOn), name: header.uploadedBy })}</p>
      {line.ok ? (
        <p className="flex items-center gap-2 text-body font-semibold">
          <CheckIcon size={20} />
          {line.text}
        </p>
      ) : (
        <Notice kind="alert">{line.text}</Notice>
      )}
    </div>
  );
}
