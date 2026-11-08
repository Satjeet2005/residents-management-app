"use client";

import { useEffect } from "react";

type Environment = { matchMedia: (query: string) => { matches: boolean }; sections: () => Iterable<{ open: boolean }> };

/** From 768px wide, opens the sections the server marked `data-default-open`; below it, opens nothing. Returns how many it opened. */
export function applyResponsiveDefaults(env: Environment): number {
  if (!env.matchMedia("(min-width: 768px)").matches) return 0;
  let opened = 0;
  for (const section of env.sections()) {
    if (section.open) continue;
    section.open = true;
    opened += 1;
  }
  return opened;
}

/**
 * Opens the first two sections from 768px wide (the server marks them with data-default-open and renders every section closed, because it cannot know the width).
 * It acts once, when the page first shows, and only on the sections the server marked: the one it opened for a drill-down is not marked, and a section the
 * server rendered open is left alone. All content is already in the HTML, so with no script the sections simply start closed.
 */
export function ResponsiveDefaults() {
  useEffect(() => {
    applyResponsiveDefaults({ matchMedia: (query) => window.matchMedia(query), sections: () => document.querySelectorAll<HTMLDetailsElement>("details[data-default-open='true']") });
  }, []);
  return null;
}
