import { expect, test } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";

/**
 * T15 Part 2, the staff screens, each checked at both widths. They read the seed and what the earlier projects of the chain left (the sample statement imported and
 * worked by tests/e2e/flows/reconciliation.spec.ts, a danger report waiting for the duty manager). Nothing here changes data.
 */
const LANES = ["needs-you", "awaiting-approval", "posted", "not-maintenance"] as const;

test.describe("staff screens: Priya Nair, payments:match", () => {
  test.use({ storageState: authFile("priya") });

  test("landing, the reconciliation start page, every lane of the workspace and the review panel", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await checkScreen(page, watch, "staff", "landing");
    await page.goto("/staff/reconciliation");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await checkScreen(page, watch, "reconciliation", "import");

    const imports = await page.request.get("/api/statements");
    const importId = (await imports.json()).imports[0].importId as string;
    for (const lane of LANES) {
      await page.goto(`/staff/reconciliation/${importId}?lane=${lane}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await checkScreen(page, watch, "workspace", lane);
    }
    await page.goto(`/staff/reconciliation/${importId}`);
    await page.getByRole("link", { name: /^Review/ }).first().click();
    await page.waitForURL(/row=/);
    await expect(page.getByRole("heading", { name: /^Review/ }).or(page.getByText("Why this needs you")).first()).toBeVisible();
    await checkScreen(page, watch, "review-panel", "open");
  });
});

test.describe("staff screens: Kavita Rao, a plain complaints manager", () => {
  test.use({ storageState: authFile("kavita") });

  test("the complaints board, every view, and a safety complaint without the duty manager's controls", async ({ page }) => {
    const watch = watchPage(page);
    for (const view of ["needs_action", "mine", "safety", "triage", "open", "overdue", "waiting", "closed"]) {
      await page.goto(`/staff/complaints?view=${view}`);
      await expect(page.getByRole("heading", { level: 1, name: "Complaints" })).toBeVisible();
      await checkScreen(page, watch, "board", view);
    }
    await page.goto("/staff/complaints?view=safety");
    await page.getByRole("link", { name: /Bench near the tower 2 gate/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bench near the tower 2 gate");
    await expect(page.getByRole("button", { name: "I have seen this" })).toHaveCount(0);
    await checkScreen(page, watch, "complaint-staff", "plain-manager");
  });
});

test.describe("staff screens: Sanjay Pawar, the duty manager", () => {
  test.use({ storageState: authFile("sanjay") });

  test("the board opens on Needs action with the safety alert, and the safety complaint offers 'I have seen this'", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/complaints");
    await expect(page.getByRole("link", { name: /safety complaints? waiting for the duty manager/ })).toBeVisible();
    await page.goto("/staff/complaints?view=safety");
    await page.getByRole("link", { name: /Bench near the tower 2 gate/ }).first().click();
    await expect(page.getByRole("button", { name: "I have seen this" })).toBeVisible();
    await checkScreen(page, watch, "complaint-staff", "duty-manager");
  });
});

test.describe("staff screens: Meera Kapoor, the committee report", () => {
  test.use({ storageState: authFile("meera") });

  test("the top, an ageing group opened, and a drill-down after Show 25 more", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/reports?period=2026-10");
    await expect(page.getByRole("heading", { level: 1, name: "Committee report" })).toBeVisible();
    await checkScreen(page, watch, "report", "top");
    await page.goto("/staff/reports?period=2026-10&bucket=over-90");
    await expect(page.getByRole("heading", { name: /\d+ flats owe .* \(Over 90 days\)/ })).toBeVisible();
    await checkScreen(page, watch, "report", "ageing");
    await page.goto("/staff/reports?period=2026-10&bucket=31-60");
    await page.getByRole("button", { name: "Show 25 more" }).click();
    await expect(page.locator("#ageing-detail tbody tr")).toHaveCount(50);
    await checkScreen(page, watch, "report", "drilldown");
  });
});

test.describe("unknown addresses: Priya Nair, staff", () => {
  test.use({ storageState: authFile("priya") });

  test("/nope shows the branded page (a real 404) and its link opens the staff landing page", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "This page does not exist." })).toBeVisible();
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
