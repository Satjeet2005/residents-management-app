import { expect, test } from "@playwright/test";
import { shoot } from "./helpers/screenshot";
import { authFile } from "./helpers/people";
import { MOBILE_360 } from "./helpers/profiles";

/**
 * T15 Part 4, the proof on the built app (localhost counts as a secure context): Chrome reports no installability error, the manifest and icons are served without a login,
 * the service worker takes control, and with the network off a page load shows the offline page, while a Home that was already open shows the offline banner and the dashed Pay.
 */
test("Chrome finds nothing that stops the app from being installed", async ({ page }) => {
  await page.goto("/login");
  const client = await page.context().newCDPSession(page);
  const { installabilityErrors } = await client.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  for (const icon of (await manifest.json()).icons as { src: string }[]) expect((await page.request.get(icon.src)).status(), icon.src).toBe(200);
});

test("the service worker takes control, and with no network a page load shows the offline page", async ({ page, context }) => {
  await page.goto("/login");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await context.setOffline(true);
  await page.goto("/login").catch(() => undefined);
  await expect(page.getByRole("heading", { level: 1, name: "You're offline." })).toBeVisible();
  await expect(page.getByText("You can't pay right now.")).toBeVisible();
  await shoot(page, "offline", "page");
  await context.setOffline(false);
});

test.describe("the Home while offline, on a phone", () => {
  test.use({ ...MOBILE_360, storageState: authFile("rohit") });

  test("says so above the dues, and Pay is the dashed, disabled control", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Pay .*₹/ }).first()).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByText("You're offline. You can't pay right now.")).toBeVisible();
    const pay = page.getByRole("button", { name: /^Pay .*₹/ }).first();
    await expect(pay).toBeDisabled();
    expect(await pay.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
    await shoot(page, "home", "offline");
    await context.setOffline(false);
    await expect(pay).toBeEnabled();
  });
});
