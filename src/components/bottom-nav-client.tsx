"use client";

import { usePathname } from "next/navigation";
import { enabledNavItems, activeNavKey } from "@/lib/nav";
import { BottomNavView } from "./bottom-nav";

/** The navigation of the resident app: it reads the path to mark the current item. */
export function BottomNav() {
  const items = enabledNavItems();
  return <BottomNavView items={items} activeKey={activeNavKey(usePathname(), items)} />;
}
