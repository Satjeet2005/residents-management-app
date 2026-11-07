import { expect, request, test, type Page } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile, type Person } from "../helpers/people";

/**
 * T13h: the staff complaints board and the complaint page in a real browser at 360, 768 and 1280 (one project each, see playwright.config.ts). Every width runs the
 * same specs: no horizontal overflow and axe (inside `checkScreen`), the board's rows, the views and filters sheets with Escape returning focus, the tabs by keyboard,
 * the phone's bar and actions sheet (below 1024px) or the side panel (from 1024px), and the duty manager's "I have seen this" with the resident's Home afterwards.
 * Each width raises its own safety complaint, so the widths do not depend on one another.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const widthOf = (page: Page): number => page.viewportSize()?.width ?? 0;
const isPhone = (page: Page): boolean => widthOf(page) < 1024;

/** The links of the complaints on the page, whether they are cards or table rows: the ones that go to a complaint page. */
const complaintLinks = (page: Page) => page.locator('li > a[href^="/staff/complaints/"]:visible, tbody a[href^="/staff/complaints/"]:visible');

/** Each width raises its danger report as its own resident, so that a resident's Home reads only the report that width acknowledged. */
const RESIDENT_OF_WIDTH: Record<number, Person> = { 360: "aamir", 768: "neeraj", 1280: "swati" };

async function raiseDanger(body: string, person: Person): Promise<void> {
  const resident = await request.newContext({ baseURL, storageState: authFile(person) });
  try {
    const response = await resident.post("/api/complaints", { data: { body, declaredDanger: true } });
    expect([200, 201]).toContain(response.status());
  } finally {
    await resident.dispose();
  }
}

test.describe("the board: Kavita Rao, a plain complaints manager", () => {
  test.use({ storageState: authFile("kavita") });

  test("the first screen of Needs action: rows, no overflow, axe", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/complaints");
    await expect(page.getByRole("heading", { level: 1, name: "Complaints" })).toBeVisible();
    await expect(complaintLinks(page).first()).toBeVisible();
    if (widthOf(page) < 768) {
      const boxes = await complaintLinks(page).evaluateAll((links) => links.map((a) => ({ top: a.getBoundingClientRect().top, bottom: a.getBoundingClientRect().bottom, height: a.getBoundingClientRect().height })));
      const viewportHeight = page.viewportSize()?.height ?? 0;
      const fully = boxes.filter((b) => b.top >= 0 && b.bottom <= viewportHeight).length;
      const tallest = Math.max(...boxes.map((b) => b.height));
      console.log(`  rows at ${widthOf(page)}px: ${boxes.length} on the page, ${fully} fully on the first ${viewportHeight}px screen, heights ${Math.min(...boxes.map((b) => b.height)).toFixed(0)} to ${tallest.toFixed(0)} px`);
      expect(fully).toBeGreaterThanOrEqual(4);
      expect(tallest).toBeLessThanOrEqual(120);
    } else {
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("columnheader")).toHaveText(["Flat", "Complaint", "Category", "Urgency", "Status", "Assigned to", "Reply", "Age"]);
    }
    await checkScreen(page, watch, "staff-complaints", "board");
  });

  test("the views: a sheet below 1024px, a sidebar from 1024px; choosing one changes the address", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/complaints");
    if (isPhone(page)) {
      const button = page.getByRole("button", { name: /^View: Needs action/ });
      await button.click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("link")).toHaveCount(8);
      await checkScreen(page, watch, "staff-complaints", "views-sheet");
      await sheet.getByRole("link", { name: /^Overdue/ }).click();
      await expect(page).toHaveURL(/view=overdue/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^View: Overdue/ })).toBeVisible();
      await page.getByRole("button", { name: /^View: Overdue/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^View: Overdue/ })).toBeFocused();
    } else {
      await expect(page.getByRole("button", { name: /^View:/ })).toHaveCount(0);
      const nav = page.getByRole("navigation", { name: "Complaint views" });
      await expect(nav.getByRole("link")).toHaveCount(8);
      await nav.getByRole("link", { name: /^Overdue/ }).click();
      await expect(page).toHaveURL(/view=overdue/);
      await expect(nav.getByRole("link", { name: /^Overdue/ })).toHaveAttribute("aria-current", "page");
    }
  });

  test("the filters sheet: Apply, the chip, Reset, and Escape returns focus", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/complaints?view=open");
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await filters.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkScreen(page, watch, "staff-complaints", "filters-sheet");
    await page.getByLabel("Category").selectOption("PLUMBING");
    await page.getByLabel("Flat code").fill("t07");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/category=PLUMBING/);
    await expect(page).toHaveURL(/q=T07/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Remove filter Category: Plumbing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Remove filter Flat: T07" })).toBeVisible();
    const flats = await complaintLinks(page).evaluateAll((links) => links.map((a) => a.closest("li, tr")?.textContent ?? ""));
    for (const text of flats) expect(text).toContain("T07-");
    await page.getByRole("link", { name: "Remove filter Flat: T07" }).click();
    await expect(page).not.toHaveURL(/q=T07/);
    await expect(page).toHaveURL(/category=PLUMBING/);
    await filters.click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page).not.toHaveURL(/category=/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await filters.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(filters).toBeFocused();
  });

  test("a hostile address is ignored: the board still opens on Needs action", async ({ page }) => {
    await page.goto("/staff/complaints?view=%27%3Bdrop&category=LIFT%27--&q=T12%25&assignee=me%3Bx&urgency=%3Cscript%3E");
    await expect(page.getByRole("heading", { level: 1, name: "Complaints" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Remove filter/ })).toHaveCount(0);
  });
});

test.describe("the complaint page: Kavita Rao", () => {
  test.use({ storageState: authFile("kavita") });

  test("a normal complaint: the tabs by keyboard, the bar and the actions sheet (or the side panel)", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/complaints?view=triage");
    await complaintLinks(page).filter({ hasNotText: "Safety" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const details = page.getByRole("tab", { name: "Details" });
    const timeline = page.getByRole("tab", { name: "Timeline" });
    await expect(details).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Details" })).toBeVisible();
    await details.focus();
    await page.keyboard.press("ArrowRight");
    await expect(timeline).toBeFocused();
    await expect(timeline).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=timeline/);
    await expect(page.getByRole("tabpanel", { name: "Timeline" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(details).toBeFocused();
    await expect(page).toHaveURL(/tab=details/);
    await page.keyboard.press("End");
    await expect(timeline).toBeFocused();
    await page.keyboard.press("Home");
    await expect(details).toBeFocused();
    await checkScreen(page, watch, "staff-complaint-detail", "normal");

    if (!isPhone(page)) {
      await expect(page.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Actions" })).toBeVisible();
      await expect(page.getByRole("button", { name: "I have seen this" })).toHaveCount(0);
      return;
    }

    await expect(page.getByRole("button", { name: "I have seen this" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close this safety complaint" })).toHaveCount(0);
    const update = page.getByRole("button", { name: "Update", exact: true });
    await update.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button")).toContainText(["Close", "Assign", "Mark in progress", "Mark resolved", "Add comment", "Correct category"]);
    await checkScreen(page, watch, "staff-complaints", "actions-sheet");

    // Assign: one small form, then the sheet closes, a live message says what changed, and focus is back on Update.
    await sheet.getByRole("button", { name: "Assign", exact: true }).click();
    await sheet.getByLabel("Assign to").selectOption({ index: 1 });
    await sheet.getByRole("button", { name: "Assign", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: /^Assigned to / })).toBeVisible();
    await expect(update).toBeFocused();

    // A comment with the box left unchecked stays internal.
    await update.click();
    await sheet.getByRole("button", { name: "Add comment" }).click();
    await sheet.getByLabel("Write a comment").fill("Checked the valve, will come back with a part");
    await expect(sheet.getByLabel("Visible to the resident")).not.toBeChecked();
    await sheet.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Comment posted. Only staff can see it." })).toBeVisible();
    await timeline.click();
    await expect(page.getByText("Comment, internal").first()).toBeVisible();
    await expect(page.getByText("Checked the valve, will come back with a part")).toBeVisible();

    // Resolve: the note is required.
    await update.click();
    await sheet.getByRole("button", { name: "Mark resolved" }).click();
    await sheet.getByRole("button", { name: "Mark resolved" }).last().click();
    await expect(sheet.getByText("Write a note of 5 to 500 characters.")).toBeVisible();
    await sheet.getByLabel("Note for the record").fill("Valve replaced and checked");
    await sheet.getByRole("button", { name: "Mark resolved" }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Marked resolved." })).toBeVisible();
  });

  test("a safety complaint: a plain manager has Update and never the duty manager's controls", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/complaints?view=safety");
    await page.getByRole("link", { name: /Bench near the tower 2 gate/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bench near the tower 2 gate");
    await expect(page.getByText("The duty manager has not seen this yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "I have seen this" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close this safety complaint" })).toHaveCount(0);
    await checkScreen(page, watch, "staff-complaint-detail", "safety-plain-manager");
    if (isPhone(page)) {
      await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Update", exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("button", { name: "Mark resolved" })).toHaveCount(0);
      await expect(page.getByRole("dialog").getByRole("button", { name: "Close this safety complaint" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("the duty manager: Sanjay Pawar", () => {
  test.use({ storageState: authFile("sanjay") });

  test("'I have seen this' is on screen at once, acknowledging works, and the resident's Home shows alert 1b", async ({ page, browser }) => {
    const watch = watchPage(page);
    const width = widthOf(page);
    const person = RESIDENT_OF_WIDTH[width];
    await raiseDanger(`Gas smell near the tower 2 stairs (${width})`, person);
    await page.goto("/staff/complaints");
    await expect(page.getByRole("link", { name: /safety complaints? waiting for the duty manager/ })).toBeVisible();
    await page.goto("/staff/complaints?view=safety");
    await page.getByRole("link", { name: new RegExp(`Gas smell near the tower 2 stairs \\(${width}\\)`) }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Gas smell near the tower 2 stairs");
    await expect(page.getByText("The duty manager has not seen this yet.")).toBeVisible();

    const seen = page.getByRole("button", { name: "I have seen this" });
    await expect(seen).toBeVisible();
    const box = await seen.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    if (isPhone(page)) await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
    await checkScreen(page, watch, "staff-complaint-detail", "safety");

    await seen.click();
    await expect(page.getByText("Marked as seen.").first()).toBeVisible();
    await expect(page.getByText(/^Seen by the duty manager at /)).toBeVisible();
    await expect(page.getByRole("button", { name: "I have seen this" })).toHaveCount(0);
    if (isPhone(page)) await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();

    const resident = await browser.newContext({ baseURL, storageState: authFile(person), viewport: page.viewportSize() ?? undefined });
    try {
      const home = await resident.newPage();
      await home.goto("/");
      await expect(home.getByText("The duty manager has seen your report")).toBeVisible();
    } finally {
      await resident.close();
    }
  });
});
