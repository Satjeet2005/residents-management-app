import { expect, test } from "@playwright/test";
import { authFile } from "../helpers/people";

/** T15 Part 3, the keyboard: Escape closes a sheet and focus returns to what opened it; the arrow keys move between the lane tabs of the reconciliation workspace. */
test.describe("sheets close with Escape and give focus back", () => {
  test.use({ storageState: authFile("rohit") });

  test("the dues sheet and the Emergency sheet", async ({ page }) => {
    await page.goto("/");
    const dues = page.getByRole("button", { name: /See what makes up this amount/ });
    await dues.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(dues).toBeFocused();

    const emergency = page.getByRole("button", { name: "Emergency" });
    await emergency.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(emergency).toBeFocused();
  });
});

test.describe("lane tabs", () => {
  test.use({ storageState: authFile("priya") });

  test("the arrow keys move between the four tabs", async ({ page }) => {
    const imports = await (await page.request.get("/api/statements")).json();
    await page.goto(`/staff/reconciliation/${imports.imports[0].importId}`);
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(tabs.nth(3)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
  });
});
