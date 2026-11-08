import type { ReactNode } from "react";
import { StaffBackLink } from "./back-link";

/** The frame of the staff pages: a back link to the staff home (not on the home itself), then the page. It checks nobody: each page asks requireUser for itself. */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <StaffBackLink />
      <div className="flex-1">{children}</div>
    </div>
  );
}
