import Link from "next/link";
import { cx } from "@/components/ui/cx";

/**
 * A sort control of two equal options (D217). They are links, so the server decides the order. The chosen one has `aria-current`, a 2px ink border and the tint;
 * the other has a 1px hairline, the SAME weight and no underline, so it does not look like a link inside a button.
 */
export function SortChoice({ label, options }: { label: string; options: readonly { href: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <Link
          key={option.href}
          href={option.href}
          aria-current={option.current ? "true" : undefined}
          className={cx("inline-flex min-h-12 items-center justify-center rounded-control border px-3 text-center text-body no-underline", option.current ? "border-2 border-ink bg-paper-2" : "border-hairline")}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
