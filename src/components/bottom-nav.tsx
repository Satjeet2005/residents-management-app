import Link from "next/link";
import { type NavItem } from "@/lib/nav";
import { t } from "@/lib/messages";
import { ChatIcon, HomeIcon, ReceiptIcon, UserIcon } from "./icons";

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

function navIcon(key: NavItem["key"]) {
  switch (key) {
    case "home":
      return <HomeIcon />;
    case "bills":
      return <ReceiptIcon />;
    case "complaints":
      return <ChatIcon />;
    case "profile":
      return <UserIcon />;
  }
}

/**
 * The bottom navigation: an icon above each label. The current item is marked with aria-current, a heavy top bar, a tint
 * and a heavier weight (never colour alone), and every item is at least 48px tall. It draws only the items it is given.
 */
export function BottomNavView({ items, activeKey }: { items: readonly NavItem[]; activeKey: NavItem["key"] | null }) {
  return (
    <nav aria-label={t("nav.label")} className="sticky bottom-0 border-t-2 border-ink bg-paper">
      <ul className="mx-auto flex max-w-3xl gap-2 px-2 py-2">
        {items.map((item) => (
          <li key={item.key} className="flex-1">
            <Link
              href={item.href}
              aria-current={item.key === activeKey ? "page" : undefined}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-control border-t-4 border-transparent px-2 py-1 text-caption aria-[current=page]:border-accent aria-[current=page]:bg-paper-2 aria-[current=page]:font-semibold"
            >
              {navIcon(item.key)}
              <span>{navLabel(item.key)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
