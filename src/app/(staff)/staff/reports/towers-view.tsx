import Link from "next/link";
import { DataTable } from "@/components/committee/data-table";
import { SortChoice } from "@/components/committee/sort-choice";
import { ArrowLeftIcon } from "@/components/icons";
import { t } from "@/lib/messages";
import { dateWords } from "@/lib/reports/period";
import { sortTowers, towersHref, towersTable } from "@/lib/reports/towers";
import type { TowersPage } from "@/server/reports/towers-page";
import { ArrivalHeading } from "./arrival-heading";

const BACK = "inline-flex min-h-12 items-center gap-2 self-start text-body font-semibold text-accent underline underline-offset-4";

/**
 * ALL the towers on a page of their own (D217): the back link "Dues", the h1 "Towers, all months", "As of <date>", the sort control (most owed first, or by tower number)
 * and ONE table: Tower, Owed, Flats owing, Over 90 days on a phone, and from 768px also Unpaid bills and Late fees, with a totals row whose Owed is Total owed. No paging
 * (the towers are few) and no explanatory paragraph.
 */
export function TowersView({ page, sort }: { page: TowersPage; sort: "owed" | "tower" }) {
  const table = towersTable({ towers: sortTowers(page.rollup.towers, sort), total: page.rollup.total }, true);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:gap-6">
      <Link href="/staff/reports/dues" aria-label={t("committee.flats.back.label")} className={BACK}>
        <ArrowLeftIcon size={20} />
        {t("committee.flats.back")}
      </Link>
      <header className="flex flex-col gap-1">
        <ArrivalHeading>{t("committee.towers.page")}</ArrivalHeading>
        <p className="text-body text-ink-2">{t("committee.asOfShort", { date: dateWords(page.asOf) })}</p>
      </header>
      <SortChoice
        label={t("committee.towers.sortLabel")}
        options={[
          { href: towersHref("owed"), label: t("committee.towers.sort.owed"), current: sort === "owed" },
          { href: towersHref("tower"), label: t("committee.towers.sort.tower"), current: sort === "tower" },
        ]}
      />
      <DataTable caption={table.caption} columns={table.columns} rows={table.rows} />
    </main>
  );
}
