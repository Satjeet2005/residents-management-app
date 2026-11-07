/** The device profiles of the browser checks (T15, T13h). Spread into a Playwright project's `use`. */
export const MOBILE_360 = {
  viewport: { width: 360, height: 800 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36",
} as const;

/** A tablet: 768 x 1024, touch. Below 1024px, so the phone's bar and sheets are in use; from 768px the board is a table. */
export const TABLET_768 = { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } as const;

export const DESKTOP_1280 = { viewport: { width: 1280, height: 800 } } as const;

/** The width a screenshot is named for: the viewport width of the page. */
export const widthOf = (viewport: { width: number } | null): number => viewport?.width ?? 0;
