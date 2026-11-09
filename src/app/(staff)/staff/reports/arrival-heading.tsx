"use client";

import { useEffect, useRef } from "react";

/** The one h1 of a section page. When the page opens, focus moves to it (it is focusable by script only), so a keyboard or screen reader person lands on the title. */
export function ArrivalHeading({ children }: { children: React.ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={heading} tabIndex={-1} className="text-heading font-semibold">
      {children}
    </h1>
  );
}
