import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav-client";

/**
 * The frame of the resident app: the page, and the navigation at the bottom. It checks nobody: each page asks
 * requireUser for itself, because a layout does not run again when a person moves between pages (Next.js authentication guide).
 */
export default function ResidentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1">{children}</div>
      <BottomNav />
    </div>
  );
}
