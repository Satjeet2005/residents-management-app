import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/** A column of a committee table. `phone` says whether it is shown below 768px: a table has at most FOUR phone columns (the first is the row header). */
export type DataColumn = { label: string; phone: boolean };
export type DataRow = { key: string; header: string; cells: readonly ReactNode[]; /** The totals row: bold, under a heavier rule. */ total?: boolean };

/** The most columns a table may show on a phone (D217). */
export const PHONE_COLUMNS = 4;

const hide = (phone: boolean): string | false => !phone && "hidden md:table-cell";

/**
 * A real table at every width, never stacked blocks: the row header, then the figures right-aligned in tabular figures. Columns that do not fit a phone are hidden
 * below 768px (`phone: false`); at most four columns stay (the row header and three figures). Header cells are 14px.
 */
export function DataTable({ caption, columns, rows, captionVisible = false, headerNoWrap = false }: { caption: string; columns: readonly DataColumn[]; rows: readonly DataRow[]; captionVisible?: boolean; /** Row headers stay on one line (a short name such as "Tower 25"), so a narrow phone gives the width to the figures. */ headerNoWrap?: boolean }) {
  return (
    <div className="min-w-0">
      <table className="tnum w-full text-left text-body">
        <caption className={cx("text-left font-semibold", captionVisible ? "pb-2" : "sr-only")}>{caption}</caption>
        <thead>
          <tr className="border-b-2 border-ink">
            {columns.map((column, index) => (
              <th key={column.label} scope="col" className={cx("py-2 text-caption font-semibold", index === 0 ? "pr-3" : "pl-3 text-right", hide(column.phone))}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={cx("border-b border-hairline", row.total === true && "border-t-2 border-ink font-semibold")}>
              <th scope="row" className={cx("py-2 pr-3 text-body", row.total === true ? "font-semibold" : "font-normal", headerNoWrap && "whitespace-nowrap")}>
                {row.header}
              </th>
              {row.cells.map((cell, index) => (
                <td key={columns[index + 1]?.label ?? index} className={cx("py-2 pl-3 text-right text-body", hide(columns[index + 1]?.phone ?? true))}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
