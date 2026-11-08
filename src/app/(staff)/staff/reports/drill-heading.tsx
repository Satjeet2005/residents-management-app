"use client";

import { useEffect, useRef } from "react";

/**
 * The heading of the drill-down. When the list opens (it mounts: the page was opened with ?bucket=, or the person followed "See the flats") focus moves to the
 * heading and it scrolls into view, so the person lands where the answer is and a screen reader reads it. It is focusable by script only (tabIndex -1).
 */
export function DrillHeading({ id, children }: { id: string; children: React.ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <h2 id={id} ref={heading} tabIndex={-1} style={{ scrollMarginTop: 16 }} className="text-title font-semibold">
      {children}
    </h2>
  );
}
