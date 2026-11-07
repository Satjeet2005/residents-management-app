import { expect, test } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";

/** The Home of a flat whose principal was paid at the bank and whose late fee is still owing: made by the reconciliation flow (a manual match of the principal-only credit of T21-1601). */
test.describe("resident screens: Aamir Shaikh, T21-1601, fee only (principal paid, the late fee owing)", () => {
  test.use({ storageState: authFile("aamir") });

  test("Home says 'Late fee due'", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "T21-1601" })).toBeVisible();
    await expect(page.getByText("Late fee due")).toBeVisible();
    await checkScreen(page, watch, "home", "fee-only");
  });
});
