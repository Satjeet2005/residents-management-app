import { expect, test } from "@playwright/test";
import { authFile } from "../helpers/people";

/**
 * T15 Part 3, the staff flows that are not reconciliation, on a desktop (1280 x 800): a complaints manager takes the complaint that a resident raised in resident-flows.spec.ts (a normal
 * one, so it is open) through Assign and Mark in progress, and the committee reader follows the ageing block into the flats behind a bucket.
 */
test.describe.configure({ mode: "serial" });

test.describe("complaints board", () => {
  test.use({ storageState: authFile("kavita") });

  test("assign a complaint, then mark it in progress", async ({ page }) => {
    await page.goto("/staff/complaints?view=open&q=T07-1203");
    await page.getByRole("link", { name: /bench in the garden has a loose plank/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("bench in the garden");
    await page.getByLabel("Assign to").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Assigned").first()).toBeVisible();
    await page.getByRole("button", { name: "Mark in progress" }).click();
    await expect(page.getByText("In progress").first()).toBeVisible();
  });
});

test.describe("committee report", () => {
  test.use({ storageState: authFile("meera") });

  test("the ageing block opens the flats behind a bucket", async ({ page }) => {
    await page.goto("/staff/reports?period=2026-10");
    await page.getByRole("link", { name: /^See the flats: Over 90 days/ }).click();
    await expect(page.getByRole("heading", { name: /\d+ flats owe .* \(Over 90 days\)/ })).toBeVisible();
    await expect(page.locator("#ageing-detail tbody tr").first()).toBeVisible();
  });
});
