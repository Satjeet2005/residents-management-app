import { expect, test } from "@playwright/test";
import { loginThroughThePage } from "./helpers/auth";
import { PHONES, authFile } from "./helpers/people";
import { widthOf } from "./helpers/profiles";
import { shoot } from "./helpers/screenshot";

/** E0: the harness itself. The app answers, the device profile is the one the project says, a screenshot is written to docs/screenshots, and a saved session opens the Home. */
test.describe("E0 the harness", () => {
  test("the login page loads at the width of the profile, and a screenshot is written", async ({ page }, testInfo) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    expect(widthOf(page.viewportSize())).toBe(testInfo.project.name === "mobile-360" ? 360 : 1280);
    expect(await page.evaluate(() => window.innerWidth)).toBe(widthOf(page.viewportSize()));
    const file = await shoot(page, "login", "idle");
    expect(file).toMatch(/docs[\\/]screenshots[\\/]login-idle-(360|1280)\.png$/);
  });

  test("the mobile profile is touch, the desktop one is not", async ({ page }, testInfo) => {
    await page.goto("/login");
    const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
    expect(touch).toBe(testInfo.project.name === "mobile-360");
  });
});

test.describe("E0 a saved session", () => {
  test.use({ storageState: authFile("swati") });

  test("opens the resident Home without a new login", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("T12-0408");
  });
});

test.describe("E0 the real login page", () => {
  test.setTimeout(150_000);
  test("a resident lands on the Home, a staff member on /staff", async ({ page }) => {
    // Anil Joshi has no saved session (the specs that need a resident of that flat use Swati's), so this is a real login with a phone nobody else is using.
    expect(await loginThroughThePage(page, PHONES.anil)).toBe("/");
    await page.context().clearCookies();
    expect(await loginThroughThePage(page, PHONES.priya)).toBe("/staff");
  });
});
