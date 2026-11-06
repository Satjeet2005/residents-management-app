import Link from "next/link";
import { type NavItem } from "@/lib/nav";
import { t } from "@/lib/messages";

function navLabel(key: NavItem["key"]): string {
  switch (key) {
    case "home":
      return t("nav.home");
    case "bills":
      return t("nav.bills");
    case "complaints":
      return t("nav.complaints");
    case "profile":
      return t("nav.profile");
  }
}

/**
 * The bottom navigation: labelled links, the current one marked with aria-current and a heavier weight and underline (not
 * colour alone), each at least 48px tall. It draws only the items it is given.
 */
export function BottomNavView({ items, activeKey }: { items: readonly NavItem[]; activeKey: NavItem["key"] | null }) {
  return (
    <nav aria-label={t("nav.label")} className="sticky bottom-0 border-t border-hairline bg-paper">
      <ul className="mx-auto flex max-w-3xl gap-2 px-2 py-2">
        {items.map((item) => (
          <li key={item.key} className="flex-1">
            <Link
              href={item.href}
              aria-current={item.key === activeKey ? "page" : undefined}
              className="flex min-h-12 items-center justify-center rounded-control border-2 border-transparent px-2 text-body aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:underline aria-[current=page]:underline-offset-4"
            >
              {navLabel(item.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
