import { statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { assertNoTextOverlap } from "../helpers/overlap";
import { authFile } from "../helpers/people";
import { MAX_BYTES } from "../helpers/screenshot";

/**
 * Committee report v2 in a real browser at 360, 768 and 1280 (one project each, see playwright.config.ts), as Meera Kapoor (reports:view), on the seeded database
 * with the business date frozen at 27 Oct 2026. Every width runs the same specs: the page checks of `checkScreen` (no overflow, 48 px targets, 8 px between them,
 * focus ring, axe, one h1, text of 14 px), the charts (each with a title, a description and a table; below 768px only the bars), the sections with
 * the keyboard, the drill-down, and the Choose sections sheet with its cookie.
 */
const widthOf = (page: Page): number => page.viewportSize()?.width ?? 0;
const wide = (page: Page): boolean => widthOf(page) >= 768;
const SECTIONS = ["money", "owed", "quality", "complaints", "bank"] as const;
const FIGURES_BELOW_768 = ["monthly-bars"];
const FIGURES_FROM_768 = ["monthly-columns", "curve", "weekly"];
const CARDS = "section[aria-label='Headline figures']";

/** Opens the report and waits for the real page: the first thing the server sends is the loading state, which has no heading. */
async function openReport(page: Page, query = "?period=2026-10"): Promise<void> {
  await page.goto(`/staff/reports${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Committee report" })).toBeVisible();
}

const openAll = (page: Page) => page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("details[data-section]").forEach((d) => (d.open = true)));
const visibleFigureIds = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("figure svg[role='img']")]
      .filter((svg) => svg.getBoundingClientRect().width > 0 && getComputedStyle(svg).visibility !== "hidden")
      .map((svg) => (svg.getAttribute("aria-labelledby") ?? "").split(" ")[0].replace(/-title$/, "")),
  );

async function closeUp(page: Page, figureId: string, name: string): Promise<string> {
  const file = path.join("docs", "screenshots", `committee-${name}-${widthOf(page)}.png`);
  await page.locator(`figure:has(svg[aria-labelledby^="${figureId}-title"])`).screenshot({ path: file, scale: "css", animations: "disabled" });
  expect(statSync(file).size, file).toBeLessThanOrEqual(MAX_BYTES);
  return file;
}

test.describe("the committee report at one width", () => {
  test.use({ storageState: authFile("meera") });

  test("the top of the page: one h1, the cards, the sections closed below 768px and the first two open from 768px; the page checks", async ({ page }) => {
    const watch = watchPage(page);
    await openReport(page);
    await expect(page.locator("section[aria-label='Headline figures'] li")).toHaveCount(4);
    for (const id of SECTIONS) await expect(page.locator(`details#${id} > summary`)).toBeVisible();
    for (const [index, id] of SECTIONS.entries()) await expect(page.locator(`details#${id}`)).toHaveJSProperty("open", wide(page) && index < 2);
    await checkScreen(page, watch, "committee", "report");
  });

  test("a phone's first screen holds the alert strip, the title, the month control and at least two whole headline cards, with no scrolling", async ({ page }) => {
    test.skip(widthOf(page) !== 360, "the first-screen acceptance is for the 360 x 800 phone");
    await openReport(page);
    const height = page.viewportSize()?.height ?? 0;
    const bottomOf = async (locator: ReturnType<Page["locator"]>) => {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      return (box?.y ?? 0) + (box?.height ?? 0);
    };
    // The strip is there only while a safety complaint is open and unseen: on the pristine seed it is, after the staff specs of the chain have acknowledged them it is not.
    const strip = page.getByRole("status").filter({ hasText: "not yet seen by the duty manager" });
    const stripShown = (await strip.count()) > 0;
    if (stripShown) expect(await bottomOf(strip)).toBeLessThanOrEqual(height);
    expect(await bottomOf(page.getByRole("heading", { level: 1 }))).toBeLessThanOrEqual(height);
    expect(await bottomOf(page.locator("#report-period"))).toBeLessThanOrEqual(height);
    const bottoms = await Promise.all((await page.locator("section[aria-label='Headline figures'] > ul > li").all()).map(bottomOf));
    const whole = bottoms.filter((bottom) => bottom <= height).length;
    console.log(`FIRST SCREEN 360x${height}: strip ${stripShown ? "shown" : "absent"}; card bottoms ${bottoms.map(Math.round).join(", ")}; whole cards visible ${whole}`);
    expect(whole).toBeGreaterThanOrEqual(2);
  });

  test("the headline cards: no sparkline, one visual, one Met or Not met tag per goal card, a goal bar whose tick is at the goal, and no overlapping text; at 360px each card is at most 190px tall", async ({ page }) => {
    await openReport(page);
    const cards = page.locator(`${CARDS} > ul > li`);
    await expect(cards).toHaveCount(4);
    await expect(page.locator(`${CARDS} svg[role='img'], ${CARDS} polyline`)).toHaveCount(0);
    for (const index of [2, 3]) {
      const card = cards.nth(index);
      await expect(card.getByText(/^(Met|Not met)$/)).toHaveCount(1);
      const bar = card.locator("[data-part='tick']");
      const track = bar.locator("xpath=..");
      const goalPercent = Number(/Goal (\d+) percent/.exec((await track.getAttribute("aria-label")) ?? "")?.[1]);
      const [trackBox, tickBox] = [await track.boundingBox(), await bar.boundingBox()];
      expect(Math.abs((((tickBox?.x ?? 0) + (tickBox?.width ?? 0) / 2 - (trackBox?.x ?? 0)) / (trackBox?.width ?? 1)) * 100 - goalPercent), "the tick is at the goal").toBeLessThan(1);
      await expect(card.locator("details > summary")).toHaveText(/Last six months/);
    }
    if (widthOf(page) === 360) {
      for (const card of await cards.all()) {
        const title = (await card.locator("h2").innerText()).trim();
        expect((await card.boundingBox())?.height ?? 0, `${title}: card height`).toBeLessThanOrEqual(190);
      }
    }
    for (const [index, card] of (await cards.all()).entries()) await assertNoTextOverlap(card, `headline card ${index + 1} at ${widthOf(page)}px`);
    for (const index of [2, 3]) {
      await cards.nth(index).locator("details > summary").click();
      await expect(cards.nth(index).locator("table tbody tr").first()).toBeVisible();
      await assertNoTextOverlap(cards.nth(index), `headline card ${index + 1} with its table open at ${widthOf(page)}px`);
    }
  });

  test("the headline cards after: a close-up at 360 and 1280", async ({ page }) => {
    test.skip(![360, 1280].includes(widthOf(page)), "the close-ups are for the phone and the laptop");
    await openReport(page);
    const file = path.join("docs", "screenshots", `committee-cards-after-${widthOf(page)}x800.png`);
    await page.locator(CARDS).screenshot({ path: file, scale: "css", animations: "disabled" });
    expect(statSync(file).size, file).toBeLessThanOrEqual(MAX_BYTES);
  });

  test("choosing a month changes the page with no Show button, and Choose sections sits at the bottom, above About", async ({ page }) => {
    await openReport(page);
    await expect(page.getByRole("button", { name: "Show", exact: true })).toHaveCount(0);
    await page.locator("#report-period").selectOption("2026-09");
    await expect(page).toHaveURL(/period=2026-09/);
    await expect(page.getByRole("heading", { name: /Money collected for September/ })).toBeVisible();
    await expect(page.locator("#report-period")).toHaveValue("2026-09");
    const choose = await page.getByRole("button", { name: "Choose sections" }).boundingBox();
    const about = await page.locator("section#about").boundingBox();
    const lastSection = await page.locator("details#bank").boundingBox();
    expect((choose?.y ?? 0) > (lastSection?.y ?? 0) + (lastSection?.height ?? 0) - 1).toBe(true);
    expect((choose?.y ?? 0) < (about?.y ?? 0)).toBe(true);
  });

  test("the drill-down opens largest first, can be turned to oldest first, and has a way back to the age groups at the top and the bottom", async ({ page }) => {
    const watch = watchPage(page);
    await openReport(page, "?period=2026-10&bucket=over-90");
    const detail = page.locator("#ageing-detail");
    await expect(detail.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(detail.getByRole("link", { name: "Largest first" })).toHaveAttribute("aria-current", "true");
    const rows = detail.locator("tbody tr:visible, ul li:visible");
    await expect(rows.first()).toBeVisible();
    const amounts = await rows.evaluateAll((els) => els.map((el) => Number(/₹([\d,]+)/.exec((el as HTMLElement).innerText)?.[1].replace(/,/g, ""))));
    expect(amounts.length).toBeGreaterThan(5);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    await expect(detail.getByText(/^Showing \d+ of \d+$/)).toBeVisible();
    await checkScreen(page, watch, "committee", "drilldown");

    await detail.getByRole("link", { name: "Oldest first" }).click();
    await expect(page).toHaveURL(/sort=oldest/);
    await expect(detail.getByRole("link", { name: "Oldest first" })).toHaveAttribute("aria-current", "true");
    const days = await detail.locator("tbody tr:visible, ul li:visible").evaluateAll((els) =>
      els.map((el) => {
        const row = el as HTMLElement;
        return Number(row.tagName === "TR" ? row.querySelectorAll("td")[1].innerText : /(\d+) days overdue/.exec(row.innerText)?.[1]);
      }),
    );
    expect(days.length).toBeGreaterThan(5);
    expect(days).toEqual([...days].sort((a, b) => b - a));

    await expect(detail.getByRole("link", { name: "← Back to age groups" })).toHaveCount(2);
    await detail.getByRole("link", { name: "← Back to age groups" }).first().click();
    await expect(page).toHaveURL(/#owed$/);
    await expect(page.locator("#ageing-detail")).toHaveCount(0);
  });

  test("the Replies card's figure is the last value of its own 'Last six months' table, which lists only months with a figure", async ({ page }) => {
    await openReport(page);
    const card = page.locator("section[aria-label='Headline figures'] > ul > li").nth(3);
    const value = (await card.locator("p.text-hero").innerText()).trim();
    await card.locator("details > summary").click();
    const rows = card.locator("details table tbody tr");
    expect((await rows.last().locator("td").innerText()).trim()).toBe(value);
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    expect(await rows.count()).toBeLessThanOrEqual(6);
  });

  test("the strip and the Complaints section give the same count of open safety complaints that nobody has seen", async ({ page }) => {
    await openReport(page);
    await openAll(page);
    const strip = page.getByRole("status").filter({ hasText: "not yet seen by the duty manager" });
    const k = (await strip.count()) > 0 ? Number(/(\d[\d,]*) safety complaints? (is|are)/.exec(await strip.innerText())?.[1].replace(/,/g, "")) : 0;
    await expect(page.locator("details#complaints")).toContainText(`Open and not yet seen, all months: ${k}`);
    console.log(`STRIP ${k} = Complaints section ${k}`);
  });

  test("every table behind a chart fits the screen with no sideways scroll, the phone table included", async ({ page }) => {
    await openReport(page);
    await openAll(page);
    await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("figure details, details:not([data-section])").forEach((d) => (d.open = true)));
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - window.innerWidth,
      tables: [...document.querySelectorAll("table")].filter((t) => t.getBoundingClientRect().width > 0).map((t) => ({ caption: t.querySelector("caption")?.textContent ?? "", extra: (t.closest(".overflow-x-auto") ?? t.parentElement)!.scrollWidth - (t.closest(".overflow-x-auto") ?? t.parentElement)!.clientWidth })),
    }));
    expect(overflow.page).toBeLessThanOrEqual(0);
    for (const table of overflow.tables) expect(table.extra, table.caption).toBeLessThanOrEqual(0);
    expect(overflow.tables.length).toBeGreaterThanOrEqual(4);
  });

  test("at 150 percent zoom on a phone (a 240 px wide screen) nothing overflows sideways, with every section and table open", async ({ page }) => {
    test.skip(widthOf(page) !== 360, "the zoom pass is for the phone");
    await page.setViewportSize({ width: 240, height: 533 });
    await openReport(page);
    await openAll(page);
    await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("figure details").forEach((d) => (d.open = true)));
    const wider = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth, elements: [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed" && el.closest(".overflow-x-auto") === null && !(el instanceof SVGElement)).map((el) => `${el.tagName.toLowerCase()} ${(el.textContent ?? "").trim().slice(0, 30)}`).slice(0, 5) }));
    expect(wider.elements).toEqual([]);
    expect(wider.page).toBeLessThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    const file = path.join("docs", "screenshots", "committee-report-zoom150-360.png");
    await page.screenshot({ path: file, scale: "css", animations: "disabled" });
    expect(statSync(file).size, file).toBeLessThanOrEqual(MAX_BYTES);
  });

  test("every section opened: the visuals, the page checks and the screenshots", async ({ page }) => {
    const watch = watchPage(page);
    await openReport(page);
    await openAll(page);
    await expect(page.locator("details#bank")).toHaveJSProperty("open", true);
    await checkScreen(page, watch, "committee", "report-open");
    if (!wide(page)) {
      await closeUp(page, "monthly-bars", "m3-monthly");
    }
    if (widthOf(page) === 1280) {
      await closeUp(page, "monthly-columns", "c1-monthly");
      await closeUp(page, "curve", "c3-curve");
      await closeUp(page, "weekly", "c4-weekly");
    }
  });

  test("each visible visual has a title, a description and a table; below 768px the only visual is the monthly bars", async ({ page }) => {
    await openReport(page);
    await openAll(page);
    expect((await visibleFigureIds(page)).sort()).toEqual((wide(page) ? FIGURES_FROM_768 : FIGURES_BELOW_768).sort());
    for (const figure of await page.locator("figure:visible").all()) {
      const svg = figure.locator("svg[role='img']");
      await expect(svg.locator("title")).not.toBeEmpty();
      await expect(svg.locator("desc")).not.toBeEmpty();
      await expect(figure.locator("figcaption")).toHaveCount(1);
      await assertNoTextOverlap(figure.locator("svg[role='img']"), `chart ${await figure.locator("figcaption").innerText()} at ${widthOf(page)}px`);
      await expect(figure.locator("details > summary")).toHaveText("See the numbers behind this chart");
      await figure.locator("details > summary").click();
      await expect(figure.locator("table caption")).toBeVisible();
      await expect(figure.locator("table th[scope='col']").first()).toBeVisible();
      await expect(figure.locator("table tbody tr").first()).toBeVisible();
    }
    expect(await page.locator("svg *[onclick], svg a, svg button").count()).toBe(0);
  });

  test("tapping an age group's link opens its drill-down of flats", async ({ page }) => {
    await openReport(page);
    await openAll(page);
    await page.getByRole("link", { name: /^See the flats: 31 to 60 days/ }).click();
    const heading = page.getByRole("heading", { name: /\d+ flats owe .* \(31 to 60 days\)/ });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.locator("#ageing-detail tbody tr:visible, #ageing-detail li:visible").first()).toBeVisible();
    await expect(page.locator("details#owed")).toHaveJSProperty("open", true);
  });

  test("the keyboard reaches the Choose sections button and the section toggles; Enter and Space toggle a section; Escape closes the sheet and returns focus", async ({ page }) => {
    await openReport(page);
    const reached = new Set<string>();
    for (let i = 0; i < 90 && reached.size < 6; i++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null) return "";
        if (el.tagName === "SUMMARY") return el.parentElement?.hasAttribute("data-section") === true ? `summary:${el.parentElement.id}` : "";
        return el.tagName === "BUTTON" ? `button:${(el.textContent ?? "").trim()}` : "";
      });
      if (label.startsWith("summary:") || label === "button:Choose sections") reached.add(label);
    }
    expect([...reached].sort()).toEqual(["button:Choose sections", ...SECTIONS.map((id) => `summary:${id}`)].sort());

    const bank = page.locator("details#bank");
    const before = await bank.evaluate((d: HTMLDetailsElement) => d.open);
    await bank.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(bank).toHaveJSProperty("open", !before);
    await page.keyboard.press("Space");
    await expect(bank).toHaveJSProperty("open", before);

    const choose = page.getByRole("button", { name: "Choose sections" });
    await choose.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(choose).toBeFocused();
  });

  test("the Choose sections sheet: one checkbox per section applied at once, one Done button, hiding one keeps it hidden after a reload, and ticking it again restores it", async ({ page, context }) => {
    const watch = watchPage(page);
    await openReport(page);
    await page.getByRole("button", { name: "Choose sections" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("checkbox")).toHaveCount(5);
    await expect(sheet.getByRole("checkbox", { name: "Complaints" })).toBeChecked();
    await checkScreen(page, watch, "committee", "choose");
    await sheet.getByRole("checkbox", { name: "Complaints" }).uncheck();
    await expect(page.locator("details#complaints")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("1 section is hidden on this device.")).toBeVisible();
    await expect(page.locator("section[aria-label='Headline figures'] li")).toHaveCount(4);
    const cookie = (await context.cookies()).find((c) => c.name === "committee_view");
    expect(cookie?.value).toBe("complaints");
    expect(cookie).toMatchObject({ path: "/staff", httpOnly: true, sameSite: "Lax" });

    await page.reload();
    await expect(page.locator("details#complaints")).toHaveCount(0);
    for (const id of SECTIONS.filter((s) => s !== "complaints")) await expect(page.locator(`details#${id}`)).toHaveCount(1);

    await page.getByRole("button", { name: "Choose sections" }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "Complaints" }).check();
    await expect(page.locator("details#complaints")).toHaveCount(1);
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    expect((await context.cookies()).find((c) => c.name === "committee_view")).toBeUndefined();
    await page.reload();
    for (const id of SECTIONS) await expect(page.locator(`details#${id}`)).toHaveCount(1);
  });
});
