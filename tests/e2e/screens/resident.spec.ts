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
    await page.getByLabel("Mobile number").fill(testInfo.project.name === "mobile-360" ? "5000000013" : "5000000014");
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
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
