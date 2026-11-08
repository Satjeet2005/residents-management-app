import { statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";
import { MAX_BYTES } from "../helpers/screenshot";

/**
 * Committee report v2 in a real browser at 360, 768 and 1280 (one project each, see playwright.config.ts), as Meera Kapoor (reports:view), on the seeded database
 * with the business date frozen at 27 Oct 2026. Every width runs the same specs: the page checks of `checkScreen` (no overflow, 48 px targets, 8 px between them,
 * focus ring, axe, one h1, text of 14 px), the charts (each with a title, a description and a table; below 768px only the bars and sparklines), the sections with
 * the keyboard, the drill-down, and the Choose sections sheet with its cookie.
 */
const widthOf = (page: Page): number => page.viewportSize()?.width ?? 0;
const wide = (page: Page): boolean => widthOf(page) >= 768;
const SECTIONS = ["money", "owed", "quality", "complaints", "bank"] as const;
const FIGURES_BELOW_768 = ["m1-collected", "m2-on-time", "m2-sla", "monthly-bars", "ageing"];
const FIGURES_FROM_768 = ["m1-collected", "m2-on-time", "m2-sla", "monthly-columns", "ageing", "curve", "weekly"];

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

  test("every section opened: the visuals, the page checks and the screenshots", async ({ page }) => {
    const watch = watchPage(page);
    await openReport(page);
    await openAll(page);
    await expect(page.locator("details#bank")).toHaveJSProperty("open", true);
    await checkScreen(page, watch, "committee", "report-open");
    if (!wide(page)) {
      await closeUp(page, "m1-collected", "m1-collected");
      await closeUp(page, "m2-on-time", "m2-on-time");
      await closeUp(page, "monthly-bars", "m3-monthly");
      await closeUp(page, "ageing", "m4-ageing");
    }
    if (widthOf(page) === 1280) {
      await closeUp(page, "monthly-columns", "c1-monthly");
      await closeUp(page, "curve", "c3-curve");
      await closeUp(page, "weekly", "c4-weekly");
    }
  });

  test("each visible visual has a title, a description and a table; below 768px the only visuals are the bars and sparklines", async ({ page }) => {
    await openReport(page);
    await openAll(page);
    expect((await visibleFigureIds(page)).sort()).toEqual((wide(page) ? FIGURES_FROM_768 : FIGURES_BELOW_768).sort());
    for (const figure of await page.locator("figure:visible").all()) {
      const svg = figure.locator("svg[role='img']");
      await expect(svg.locator("title")).not.toBeEmpty();
      await expect(svg.locator("desc")).not.toBeEmpty();
      await expect(figure.locator("figcaption")).toHaveCount(1);
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
    await expect(page.getByRole("heading", { name: /Open dues: 31 to 60 days/ })).toBeVisible();
    await expect(page.locator("#ageing-detail tbody tr:visible, #ageing-detail li:visible").first()).toBeVisible();
    await expect(page.locator("details#owed")).toHaveJSProperty("open", true);
  });

  test("the keyboard reaches the Choose sections button and the section toggles; Enter and Space toggle a section; Escape closes the sheet and returns focus", async ({ page }) => {
    await openReport(page);
    const reached = new Set<string>();
    for (let i = 0; i < 60 && reached.size < 6; i++) {
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

  test("the Choose sections sheet: one checkbox per section, hiding one keeps it hidden after a reload, and Show everything restores it", async ({ page, context }) => {
    const watch = watchPage(page);
    await openReport(page);
    await page.getByRole("button", { name: "Choose sections" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("checkbox")).toHaveCount(5);
    await expect(sheet.getByRole("checkbox", { name: "Complaints" })).toBeChecked();
    await checkScreen(page, watch, "committee", "choose");
    await sheet.getByRole("checkbox", { name: "Complaints" }).uncheck();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("details#complaints")).toHaveCount(0);
    await expect(page.getByText("1 section is hidden on this device.")).toBeVisible();
    await expect(page.locator("section[aria-label='Headline figures'] li")).toHaveCount(4);
    const cookie = (await context.cookies()).find((c) => c.name === "committee_view");
    expect(cookie?.value).toBe("complaints");
    expect(cookie).toMatchObject({ path: "/staff", httpOnly: true, sameSite: "Lax" });

    await page.reload();
    await expect(page.locator("details#complaints")).toHaveCount(0);
    for (const id of SECTIONS.filter((s) => s !== "complaints")) await expect(page.locator(`details#${id}`)).toHaveCount(1);

    await page.getByRole("button", { name: "Choose sections" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Show everything" }).click();
    await expect(page.locator("details#complaints")).toHaveCount(1);
    expect((await context.cookies()).find((c) => c.name === "committee_view")).toBeUndefined();
    await page.reload();
    for (const id of SECTIONS) await expect(page.locator(`details#${id}`)).toHaveCount(1);
  });
});
