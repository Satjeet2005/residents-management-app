export type NavItem = {
  key: "home" | "bills" | "complaints" | "profile";
  /** The message key of the label. */
  labelKey: "nav.home" | "nav.bills" | "nav.complaints" | "nav.profile";
  href: string;
  /** False until the feature exists: a disabled item is not drawn at all (every affordance is built or absent). */
  enabled: boolean;
};

/**
 * The resident navigation. Bills and Complaints are listed so the order is fixed, and switched on by the task that builds
 * them (a later task); until then they are not rendered.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", labelKey: "nav.home", href: "/", enabled: true },
  { key: "bills", labelKey: "nav.bills", href: "/bills", enabled: false },
  { key: "complaints", labelKey: "nav.complaints", href: "/complaints", enabled: false },
  { key: "profile", labelKey: "nav.profile", href: "/profile", enabled: true },
];

/** The items to draw. */
export const enabledNavItems = (items: readonly NavItem[] = NAV_ITEMS): NavItem[] => items.filter((item) => item.enabled);

/** The item that is active for a path: the longest href that the path equals or sits under ("/" matches only "/"). */
export function activeNavKey(pathname: string, items: readonly NavItem[] = enabledNavItems()): NavItem["key"] | null {
  const matches = items.filter((item) => (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)));
  matches.sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.key ?? null;
}
