import { expect, test, type Page } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";

/**
 * T13i: the SEEDED forced gas complaint ("Smell of gas in the corridor", raised 27 Oct 2026 11:00 from tower T09, assigned to the duty manager) opens for the duty
 * manager, who presses "I have seen this" on a 360 x 800 phone. Before the fix its events held a seed key where a UUID belongs and the page answered "We could not load
 * the complaints". It runs BEFORE every spec that acknowledges a safety complaint (see playwright.config.ts), so the complaint is still unacknowledged.
 * Nobody else touches the seeded complaint.
 */
const GAS = /^T09-\d+ .*Smell of gas in the corridor/;

/** The count the committee report's alert strip announces: 0 when there is no strip. */
async function alertCount(page: Page): Promise<number> {
  await page.goto("/staff/reports");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const strip = page.getByRole("status").filter({ hasText: /safety complaints? (is|are) waiting for the duty manager/ });
  if ((await strip.count()) === 0) return 0;
  const text = await strip.first().innerText();
  return /^1 safety complaint is/.test(text.trim()) ? 1 : Number(/^(\d+) safety complaints are/.exec(text.trim())?.[1]);
}

test.describe("the seeded gas complaint: Sanjay Pawar, the duty manager", () => {
  test.use({ storageState: authFile("sanjay") });

  test("opens from the safety view, shows 'not seen', 'I have seen this' is on screen without scrolling, pressing it marks it seen, and the report's alert count drops by one", async ({ browser, page }) => {
    const watch = watchPage(page);
    const committee = await browser.newContext({ storageState: authFile("meera"), baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: page.viewportSize() ?? undefined });
    const reportPage = await committee.newPage();
    const before = await alertCount(reportPage);
    expect(before).toBeGreaterThanOrEqual(1);

    await page.goto("/staff/complaints?view=safety");
    await expect(page.getByRole("heading", { level: 1, name: "Complaints" })).toBeVisible();
    await page.getByRole("link", { name: GAS }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Smell of gas in the corridor");
    await expect(page.getByText("The duty manager has not seen this yet.")).toBeVisible();
    await expect(page.getByText("We could not load")).toHaveCount(0);

    const seen = page.getByRole("button", { name: "I have seen this" });
    await expect(seen).toBeVisible();
    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: 360, height: 800 });
    const box = await seen.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await checkScreen(page, watch, "staff-complaint-detail", "seeded-gas");

    await seen.click();
    await expect(page.getByText(/^Seen by the duty manager at /)).toBeVisible();
    await expect(page.getByRole("button", { name: "I have seen this" })).toHaveCount(0);

    expect(await alertCount(reportPage)).toBe(before - 1);
    await committee.close();
  });
});
