import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";

/**
 * T15 Part 2, the resident screens, each checked at both widths (see helpers/checks.ts for what a check is). Every spec here only READS the seeded data, so the
 * order of the specs and of the two profiles does not matter: Swati (T12-0408) is overdue, Neeraj (T07-1203) has no dues, Rohit (T15-0902) has two unpaid bills.
 */
test.describe("resident screens: logged out", () => {
  test("login, idle and after sending a code", async ({ page }, testInfo) => {
    const watch = watchPage(page);
    await page.goto("/login");
    await checkScreen(page, watch, "login", "idle");
    // A phone is asked to wait 30 seconds between codes, so each profile uses its own.
    await page.getByLabel("Mobile number").fill(testInfo.project.name.endsWith("-360") ? "5000000013" : "5000000014");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(/Demo mode: your code is \d{6}/)).toBeVisible();
    await checkScreen(page, watch, "login", "code-sent");
  });
});

test.describe("resident screens: Swati Joshi, T12-0408, overdue", () => {
  test.use({ storageState: authFile("swati") });

  test("Home, the dues sheet, the Emergency sheet", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "T12-0408" })).toBeVisible();
    await checkScreen(page, watch, "home", "overdue");
    // D226: the demo's frozen date is told in one line at the very bottom, so the Pay button stays on the first screen and above the note.
    const pay = await page.getByRole("button", { name: /^Pay .*₹/ }).first().boundingBox();
    const note = await page.getByText(/business date is fixed at 27 October 2026/).boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    expect(pay).not.toBeNull();
    expect(note).not.toBeNull();
    expect((pay?.y ?? Infinity) + (pay?.height ?? 0)).toBeLessThanOrEqual(height);
    expect(note?.y ?? 0).toBeGreaterThan(pay?.y ?? Infinity);
    await page.getByRole("button", { name: /See what makes up this amount/ }).click();
    await expect(page.getByRole("dialog").or(page.getByRole("heading", { name: "Your dues" })).first()).toBeVisible();
    await checkScreen(page, watch, "dues-sheet", "open");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Emergency" }).click();
    await expect(page.getByRole("heading", { name: "Emergency help" })).toBeVisible();
    await checkScreen(page, watch, "emergency-sheet", "open");
  });

  test("complaints list, the raise form before and after choosing Yes, a complaint", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/complaints");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await checkScreen(page, watch, "complaints", "list");
    await page.goto("/complaints/new");
    await checkScreen(page, watch, "complaint-new", "empty");
    await page.getByRole("radio", { name: "Yes" }).check();
    await expect(page.getByText(/call the duty manager now/i)).toBeVisible();
    await checkScreen(page, watch, "complaint-new", "danger-yes");
    await page.goto("/complaints");
    await page.getByRole("link", { name: /Water leak/ }).first().click();
    // The heading of the NEW page: "any h1" would match the list while the click is still navigating.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Water leak");
    await checkScreen(page, watch, "complaint", "detail");
  });

  test("profile", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await checkScreen(page, watch, "profile", "swati");
  });
});

test.describe("resident screens: Neeraj Kulkarni, T07-1203, no dues", () => {
  test.use({ storageState: authFile("neeraj") });

  test("Home with no dues, and the complaint that waits for his answer", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "T07-1203" })).toBeVisible();
    await checkScreen(page, watch, "home", "no-dues");
    await page.goto("/complaints");
    await page.getByRole("link", { name: /Corridor light/ }).first().click();
    await expect(page.getByText("Is it fixed?")).toBeVisible();
    await checkScreen(page, watch, "complaint", "needs-answer");
  });
});

test.describe("resident screens: Rohit Deshmukh, T15-0902, with a danger report (the data state of helpers/states.ts)", () => {
  test.use({ storageState: authFile("rohit") });

  test("Home with the safety alert 1a and an outlined Pay, the safety complaint, and the demo payment page", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/");
    await expect(page.getByText("Your report has gone to the duty manager")).toBeVisible();
    await expect(page.getByRole("link", { name: "Call duty manager" })).toBeVisible();
    await checkScreen(page, watch, "home", "safety-alert-1a");
    await page.goto("/complaints");
    await page.getByRole("link", { name: /Bench near the tower 2 gate/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bench near the tower 2 gate");
    await checkScreen(page, watch, "complaint", "safety");
    await page.goto("/");
    await page.getByRole("button", { name: /^Pay .*₹/ }).first().click();
    await page.waitForURL(/\/pay\/mock\//);
    await checkScreen(page, watch, "pay", "demo-page");
  });
});

/** A-006: the branded page for an unknown address, for a logged-out visitor and a resident. It is a real HTTP 404, readable at 360 px, with one 48 px link. */
async function expectNotFoundPage(page: import("@playwright/test").Page, address: string) {
  const response = await page.goto(address);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "This page does not exist." })).toBeVisible();
  const link = page.getByRole("link", { name: "Go to the home page" });
  await expect(link).toHaveCount(1);
  const box = await link.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  return link;
}

test.describe("unknown addresses: logged out", () => {
  test("/nope shows the page and its link leads to the login page", async ({ page }) => {
    const link = await expectNotFoundPage(page, "/nope");
    await link.click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("unknown addresses: Swati Joshi, a resident", () => {
  test.use({ storageState: authFile("swati") });

  test("/nope and an unknown demo checkout show the page, and the link opens her Home", async ({ page }) => {
    await expectNotFoundPage(page, "/pay/mock/00000000-0000-4000-8000-000000000000");
    const link = await expectNotFoundPage(page, "/nope");
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: "T12-0408" })).toBeVisible();
  });
});
