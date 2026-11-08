import { expect, test, type Page } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";
import { sql, sqlRows } from "../helpers/sql";

/**
 * The Filters sheet of the reconciliation workspace (D192) in a browser, as Priya on the import the reconciliation flow left. The sheet opens, Apply and Reset change the
 * address, Escape closes it and focus goes back to the Filters button, the chips remove one choice at a time, the filters survive a reload, the sheet holds the page
 * scroll, hostile values give the defaults, and the rows and counts shown equal SQL written here (the amount boundary included). Also axe, targets and overflow with
 * the sheet open and with filters on. Writes the two screenshots of docs/screenshots/reconciliation-filters-*.
 */
test.use({ storageState: authFile("priya") });

const NOFLAT = ["NO_NARRATION", "NO_MATCH"];
const noflatSql = NOFLAT.map((code) => `b.parsed->'decision'->'reasons' @> '[{"code": "${code}"}]'::jsonb`).join(" OR ");

async function open(page: Page, query = ""): Promise<string> {
  const list = (await (await page.request.get("/api/statements")).json()) as { imports: { importId: string }[] };
  const importId = list.imports[0].importId;
  await page.goto(`/staff/reconciliation/${importId}${query}`);
  await expect(page.getByRole("tab", { selected: true })).toBeVisible();
  return importId;
}

const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const width = (page: Page) => page.viewportSize()?.width ?? 0;

test("open the sheet, choose, Apply: the address, the rows and the counts equal SQL; chips remove one at a time; a reload keeps them", async ({ page }) => {
  const watch = watchPage(page);
  const importId = await open(page);
  const threshold = (await sql<{ v: string }>(`SELECT value::text AS v FROM society_settings WHERE key = 'approval_threshold_paise'`)).v;
  await filtersButton(page).click();
  const sheet = page.getByRole("dialog", { name: "Filters and sort" });
  await expect(sheet).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await expect(sheet.getByRole("radio")).toHaveCount(10);
  await expect(sheet.getByRole("button", { name: "Apply" })).toBeVisible();
  const heights = await sheet.getByRole("radio").evaluateAll((els) => els.map((el) => (el.closest("label") as HTMLElement).getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);
  await expect(sheet.getByText(`₹${Number(threshold) / 100 >= 1000 ? (Number(threshold) / 100).toLocaleString("en-IN") : Number(threshold) / 100} or more (needs a second approver)`)).toBeVisible();
  if (width(page) === 360) await page.screenshot({ path: "docs/screenshots/reconciliation-filters-sheet-360x800.png", scale: "css" });
  await checkScreen(page, watch, "reconciliation-filters", "sheet");

  await sheet.getByLabel("Oldest first").check();
  await sheet.getByLabel(/or more \(needs a second approver\)/).check();
  await sheet.getByLabel(/^No flat found/).check();
  await sheet.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/sort=oldest&amount=high&reason=noflat/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");

  const expected = await sqlRows<{ id: string; amount: string }>(
    `SELECT b.id::text AS id, GREATEST(b.credit_paise, b.debit_paise)::text AS amount FROM bank_rows b WHERE b.import_id = $1::uuid AND b.state = 'QUEUED' AND GREATEST(b.credit_paise, b.debit_paise) >= $2::bigint AND (${noflatSql}) ORDER BY b.txn_date ASC, b.id ASC`,
    [importId, threshold],
  );
  expect(expected.length).toBeGreaterThan(0);
  await expect(page.getByText(`Showing ${Math.min(25, expected.length)} of ${expected.length} rows (filtered)`)).toBeVisible();
  const shownIds = await page.locator('[role="tabpanel"] li a[id^="recon-row-"]').evaluateAll((els) => els.map((el) => el.id.replace("recon-row-", "")));
  expect(shownIds).toEqual(expected.slice(0, 25).map((r) => r.id));
  await expect(filtersButton(page)).toHaveText("Filters (3)");
  await expect(page.getByRole("button", { name: /^Remove filter:/ })).toHaveCount(3);
  if (width(page) === 360) await page.screenshot({ path: "docs/screenshots/reconciliation-filters-active-360x800.png", scale: "css" });
  await checkScreen(page, watch, "reconciliation-filters", "active");

  // The filters are in the address: a reload keeps them.
  await page.reload();
  await expect(filtersButton(page)).toHaveText("Filters (3)");
  await expect(page.getByText(/\(filtered\)/)).toBeVisible();

  // The chips take one choice off at a time.
  await page.getByRole("button", { name: "Remove filter: No flat found" }).click();
  await expect(page).toHaveURL(/sort=oldest&amount=high$/);
  await expect(filtersButton(page)).toHaveText("Filters (2)");
  await page.getByRole("button", { name: /^Remove filter: Oldest first/ }).click();
  await expect(page).toHaveURL(/amount=high$/);
  await page.getByRole("button", { name: /^Remove filter: .* or more/ }).click();
  await expect(page).not.toHaveURL(/amount=|sort=|reason=/);
  await expect(filtersButton(page)).toHaveText("Filters");
});

test("Escape closes the sheet and focus goes back to the Filters button; Reset clears the address", async ({ page }) => {
  await open(page, "?sort=oldest&reason=several");
  await filtersButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Filters and sort" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Oldest first/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(filtersButton(page)).toBeFocused();
  await filtersButton(page).click();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page).not.toHaveURL(/sort=|reason=/);
  await expect(filtersButton(page)).toHaveText("Filters");
});

test("the counts beside the reasons equal SQL, and the reason group is off on a lane without reasons", async ({ page }) => {
  const importId = await open(page);
  const lane = await sql<{ n: number; noflat: number }>(`SELECT count(*)::int AS n, (count(*) FILTER (WHERE ${noflatSql}))::int AS noflat FROM bank_rows b WHERE b.import_id = $1::uuid AND b.state = 'QUEUED'`, [importId]);
  await filtersButton(page).click();
  const sheet = page.getByRole("dialog", { name: "Filters and sort" });
  await expect(sheet.locator("label", { hasText: /^No flat found/ })).toContainText(String(lane.noflat));
  await expect(sheet.locator("label", { hasText: /^Any reason/ })).toContainText(String(lane.n));
  await expect(sheet.getByText("A row can have more than one reason, so the counts can add up to more than the lane total")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/staff/reconciliation/${importId}?lane=posted`);
  await filtersButton(page).click();
  await expect(page.getByRole("dialog").getByText("Applies to Needs you and Awaiting approval rows")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("radio", { name: /^No flat found/ })).toBeDisabled();
});

test("hostile values in the address give the defaults, and a combination with no rows says so with a way back", async ({ page }) => {
  const importId = await open(page, "?sort=%27%3BDROP&amount=zzz&reason=%3Cscript%3E");
  await expect(page.getByText(/Showing \d+ of \d+ rows$/)).toBeVisible();
  await expect(filtersButton(page)).toHaveText("Filters");
  // Find a filter combination that leaves no row of a lane that has rows, by SQL over every combination; the browser then shows it.
  const threshold = (await sql<{ v: string }>(`SELECT value::text AS v FROM society_settings WHERE key = 'approval_threshold_paise'`)).v;
  const codes: Record<string, string[]> = { noflat: NOFLAT, several: ["CODE_AMBIGUOUS", "CODE_CONFLICT", "PAYER_SHARED", "MULTIPLE_FLATS_OWE"], differs: ["AMOUNT_PRINCIPAL_ONLY", "AMOUNT_LESS", "AMOUNT_MORE", "NO_OPEN_BILL", "HINT_CONFLICT"], low: ["NAME_INITIAL", "NAME_TRUNCATED", "LATER_PAYMENT", "NEEDS_SECOND_SIGNAL", "STATE_CHANGED"] };
  const reasonSql = (reason: string) => codes[reason].map((c) => `b.parsed->'decision'->'reasons' @> '[{"code": "${c}"}]'::jsonb`).join(" OR ") + (reason === "low" ? ` OR b.parsed->'decision'->>'confidence' = 'LOW'` : "");
  let empty: string | null = null;
  for (const amount of ["high", "low"] as const) {
    for (const reason of ["noflat", "several", "differs", "low"]) {
      const n = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bank_rows b WHERE b.import_id = $1::uuid AND b.state = 'QUEUED' AND GREATEST(b.credit_paise, b.debit_paise) ${amount === "high" ? ">=" : "<"} $2::bigint AND (${reasonSql(reason)})`, [importId, threshold]);
      if (n.n === 0 && empty === null) empty = `?amount=${amount}&reason=${reason}`;
    }
  }
  test.info().annotations.push({ type: "empty combination", description: empty ?? "none in this data: the empty state is covered by the render test WS8" });
  test.skip(empty === null, "no combination is empty in this data; the empty state is covered by tests/ui/reconciliation-workspace.test.ts (WS8)");
  await page.goto(`/staff/reconciliation/${importId}${empty}`);
  await expect(page.getByText("No rows match these filters")).toBeVisible();
  await page.getByRole("link", { name: "Reset filters" }).click();
  await expect(page).not.toHaveURL(/amount=|reason=/);
  await expect(page.getByText(/Showing \d+ of \d+ rows$/)).toBeVisible();
});

test("the sheet holds the page scroll: scrolling inside does not move the page behind (the shared lock)", async ({ page }) => {
  test.skip(width(page) !== 360, "phone only");
  await page.setViewportSize({ width: 360, height: 500 });
  await open(page);
  await page.evaluate(() => window.scrollTo(0, 300));
  await filtersButton(page).dispatchEvent("click");
  const sheet = page.getByRole("dialog", { name: "Filters and sort" });
  await expect(sheet).toBeVisible();
  const before = await page.evaluate(() => document.body.style.top);
  expect(before).toMatch(/^-\d+px$/);
  await page.mouse.move(180, 300);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.body.style.top)).toBe(before);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe("");
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(300);
});
