import { defineConfig, type PlaywrightTestProject } from "@playwright/test";
import { DESKTOP_1280, MOBILE_360, TABLET_768 } from "./tests/e2e/helpers/profiles";

/**
 * The real-browser checks (T15). Chromium only. `npm run e2e` (scripts/e2e.sh) builds the app on a scratch database, starts it and sets E2E_BASE_URL; running
 * this file any other way needs the app already running at that address. One worker, because the specs share one seeded database, and the projects run as a CHAIN,
 * because the data they read is changed by the ones before:
 *   1 and 2  the resident screens at 360 and at 1280 (they only read: Swati owes, Neeraj does not, Rohit has a danger report);
 *   3        the resident flows (real clicks: pay, complaints, the Home alerts; they change data);
 *   4        the reconciliation flow, which imports the sample statement through the page, matches, requests and approves (it changes Swati's bank row, Aamir's late fee);
 *   5 and 6  the staff screens at 360 and at 1280, and the Home of a flat that owes only a late fee (they read what 3 and 4 left);
 *   6b       the SEEDED gas complaint opened and acknowledged by the duty manager at 360 (T13i; it must run before any spec that acknowledges a safety complaint);
 *   7        the staff complaints board and complaint page at 360, 768 and 1280 (T13h; they change complaints: they assign, comment, resolve and acknowledge);
 *   8        the committee report v2 at 360, 768 and 1280 (read only, apart from the section choice, which is a cookie of the browser context);
 *   9        the other staff flows, the keyboard, the installability and the offline page.
 * The device profiles are a 360 x 800 phone (mobile emulation, touch), a 768 x 1024 tablet and a 1280 x 800 desktop.
 */
const chain: { name: string; profile: typeof MOBILE_360 | typeof TABLET_768 | typeof DESKTOP_1280; match: RegExp }[] = [
  { name: "resident-screens-360", profile: MOBILE_360, match: /screens[\\/]resident\.spec\.ts$/ },
  { name: "resident-screens-1280", profile: DESKTOP_1280, match: /screens[\\/]resident\.spec\.ts$/ },
  { name: "resident-flows", profile: MOBILE_360, match: /flows[\\/]resident-.*\.spec\.ts$/ },
  { name: "reconciliation-flow", profile: DESKTOP_1280, match: /flows[\\/]reconciliation\.spec\.ts$/ },
  { name: "staff-screens-360", profile: MOBILE_360, match: /screens[\\/](staff|after-reconciliation)\.spec\.ts$/ },
  { name: "staff-screens-1280", profile: DESKTOP_1280, match: /screens[\\/](staff|after-reconciliation)\.spec\.ts$/ },
  { name: "seeded-safety-360", profile: MOBILE_360, match: /screens[\\/]seeded-safety\.spec\.ts$/ },
  { name: "staff-complaints-360", profile: MOBILE_360, match: /screens[\\/]staff-complaints\.spec\.ts$/ },
  { name: "staff-complaints-768", profile: TABLET_768, match: /screens[\\/]staff-complaints\.spec\.ts$/ },
  { name: "staff-complaints-1280", profile: DESKTOP_1280, match: /screens[\\/]staff-complaints\.spec\.ts$/ },
  { name: "committee-report-360", profile: MOBILE_360, match: /screens[\\/]committee-report\.spec\.ts$/ },
  { name: "committee-report-768", profile: TABLET_768, match: /screens[\\/]committee-report\.spec\.ts$/ },
  { name: "committee-report-1280", profile: DESKTOP_1280, match: /screens[\\/]committee-report\.spec\.ts$/ },
  { name: "staff-flows", profile: DESKTOP_1280, match: /flows[\\/](staff|keyboard)-.*\.spec\.ts$|installable\.spec\.ts$|harness\.spec\.ts$/ },
];

const projects: PlaywrightTestProject[] = chain.map((link, index) => ({
  name: link.name,
  use: { ...link.profile },
  testMatch: link.match,
  dependencies: index === 0 ? [] : [chain[index - 1].name],
}));

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
  projects,
});
