import { expect, test, type Page } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";
import { sql } from "../helpers/sql";

/**
 * The reconciliation workspace (D189 to D191) in a browser on the import the reconciliation flow left, as Priya. At 360 x 800: the selector block is at most 150 px tall,
 * at least three complete rows are on the first screen, every row is at most 120 px tall, no row text is clipped, the four tabs are equal in width within a row, the arrow
 * keys move between the tabs and change ?lane=, the counts equal SQL written here, and the words of the old legend are not in the page. Enter and Space on a row open its
 * review and Escape closes it with focus back on the same row. At 360, 768 and 1280: no horizontal overflow, axe, targets, one filled control (checkScreen).
 */
test.use({ storageState: authFile("priya") });

async function workspace(page: Page, lane = "needs-you"): Promise<{ importId: string; url: string }> {
  const list = (await (await page.request.get("/api/statements")).json()) as { imports: { importId: string }[] };
  const importId = list.imports[0].importId;
  return { importId, url: `/staff/reconciliation/${importId}?lane=${lane}` };
}

const width = (page: Page) => page.viewportSize()?.width ?? 0;

test("the first screen: the selector, the rows, the numbers (360 x 800)", async ({ page }) => {
  test.skip(width(page) !== 360, "phone only");
  const watch = watchPage(page);
  const { importId, url } = await workspace(page);
  await page.goto(url);
  const tablist = page.getByRole("tablist");
  await expect(tablist).toBeVisible();
  await expect(page.getByText(/All \d+ rows accounted for/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bank statement matching");
  await page.screenshot({ path: "docs/screenshots/reconciliation-after-360x800.png", scale: "css" });

  // The selector: at most 150 px tall, four tabs, equal widths within a row of the grid, counts equal to SQL, no legend words.
  const selector = await tablist.boundingBox();
  const tabs = await page.getByRole("tab").evaluateAll((els) => els.map((el) => ({ top: Math.round(el.getBoundingClientRect().top), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  expect(tabs).toHaveLength(4);
  for (const row of new Set(tabs.map((t) => t.top))) {
    const widths = tabs.filter((t) => t.top === row).map((t) => t.width);
    expect(Math.max(...widths) - Math.min(...widths), `tab widths in the row at ${row}`).toBeLessThanOrEqual(1);
  }
  for (const tab of tabs) expect(tab.height).toBeGreaterThanOrEqual(64);
  console.log("reconciliation 360x800: selector", Math.round(selector?.height ?? 0), "px; tab heights", JSON.stringify(tabs.map((t) => Math.round(t.height))));
  expect(selector?.height ?? 999).toBeLessThanOrEqual(150);
  const db = await sql<{ needs: number; awaiting: number; posted: number; ignored: number }>(
    `SELECT (count(*) FILTER (WHERE state = 'QUEUED'))::int AS needs, (count(*) FILTER (WHERE state = 'AWAITING_APPROVAL'))::int AS awaiting, (count(*) FILTER (WHERE state IN ('AUTO_MATCHED','MANUALLY_MATCHED')))::int AS posted, (count(*) FILTER (WHERE state = 'IGNORED'))::int AS ignored FROM bank_rows WHERE import_id = $1::uuid`,
    [importId],
  );
  const rowsWord = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;
  for (const [name, n] of [["Needs you", db.needs], ["Awaiting approval", db.awaiting], ["Posted", db.posted], ["Not maintenance", db.ignored]] as const) {
    await expect(page.getByRole("tab", { name: `${name} ${rowsWord(n)}`, exact: true }), `${name} has ${n} rows in SQL`).toBeVisible();
  }
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("Posted automatically");
  expect(body).not.toMatch(/\bNeed you\b/);

  // The rows: at least three complete on the first screen, every one at most 120 px, nothing clipped sideways.
  const rows = await page.locator('[role="tabpanel"] li').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const clipped = [el, ...el.querySelectorAll("*")].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).display !== "inline" && !n.classList.contains("sr-only")).length;
      return { top: r.top + scrollY, bottom: r.bottom + scrollY, height: r.height, clipped };
    }),
  );
  const complete = rows.filter((r) => r.bottom <= 800).length;
  const tallest = Math.max(...rows.map((r) => r.height));
  console.log("reconciliation 360x800:", rows.length, "rows loaded;", complete, "complete on the first screen; tallest row", Math.round(tallest), "px");
  expect(complete).toBeGreaterThanOrEqual(3);
  expect(tallest).toBeLessThanOrEqual(120);
  expect(rows.filter((r) => r.clipped > 0)).toHaveLength(0);
  await checkScreen(page, watch, "reconciliation-workspace", "needs-you");
});

test("the arrow keys, Home and End move between the tabs and change ?lane=", async ({ page }) => {
  const { url } = await workspace(page);
  await page.goto(url);
  const first = page.getByRole("tab").first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/lane=awaiting-approval/);
  await expect(page.getByRole("tab", { name: /^Awaiting approval/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page).toHaveURL(/lane=not-maintenance/);
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /^Needs you/ })).toBeFocused();
  await expect(page).not.toHaveURL(/lane=/);
});

for (const key of ["Enter", " "]) {
  test(`${key === " " ? "Space" : key} on a row opens its review, Escape closes it and focus returns to the same row`, async ({ page }) => {
    const { url } = await workspace(page);
    await page.goto(url);
    const row = page.getByRole("link", { name: /^Review / }).first();
    const id = await row.getAttribute("id");
    await row.focus();
    await page.keyboard.press(key);
    await expect(page).toHaveURL(/row=/);
    await expect(page.getByText("Why this needs you")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Reviewing / })).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/row=/);
    await expect(page.locator(`#${id}`)).toBeFocused();
  });
}

test("every lane at this width: no horizontal overflow, axe clean, one filled control", async ({ page }) => {
  const watch = watchPage(page);
  for (const lane of ["needs-you", "awaiting-approval", "posted", "not-maintenance"]) {
    const { url } = await workspace(page, lane);
    await page.goto(url);
    await expect(page.getByRole("tab", { selected: true })).toBeVisible();
    if (lane === "needs-you" && width(page) === 1280) await page.screenshot({ path: "docs/screenshots/reconciliation-after-1280.png", scale: "css" });
    await checkScreen(page, watch, "reconciliation-workspace", lane);
  }
});
