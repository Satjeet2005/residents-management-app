import type { ReactNode } from "react";

/** The frame of the staff pages. It checks nobody: each page asks requireUser for itself. */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col">{children}</div>;
}
