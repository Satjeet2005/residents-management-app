import { defineConfig } from "@playwright/test";
import { DESKTOP_1280, MOBILE_360 } from "./tests/e2e/helpers/profiles";

/**
 * The real-browser checks (T15). Chromium only. `npm run e2e` (scripts/e2e.sh) builds the app on a scratch database, starts it and sets E2E_BASE_URL; running
 * this file any other way needs the app already running at that address. One worker, because the specs share one seeded database. The two device profiles are
 * a 360 x 800 phone (mobile emulation, touch) and a 1280 x 800 desktop; the checks of every screen run in both.
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "off", screenshot: "off", video: "off" },
  // A spec runs in both profiles unless its name says otherwise: `x.mobile-only.spec.ts` or `x.desktop-only.spec.ts`.
  projects: [
    { name: "mobile-360", use: { ...MOBILE_360 }, testMatch: /.*\.spec\.ts$/, testIgnore: /\.desktop-only\.spec\.ts$/ },
    { name: "desktop-1280", use: { ...DESKTOP_1280 }, testMatch: /.*\.spec\.ts$/, testIgnore: /\.mobile-only\.spec\.ts$/ },
  ],
});
