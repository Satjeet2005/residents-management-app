import { statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { checkScreen, watchPage } from "../helpers/checks";
import { authFile } from "../helpers/people";
import { assertNoTextOverlap } from "../helpers/overlap";
import { MAX_BYTES } from "../helpers/screenshot";

/**
 * The committee report in a real browser at 360, 768 and 1280 (one project each, see playwright.config.ts), as Meera Kapoor (reports:view), on the seeded database with
 * the business date frozen at 27 Oct 2026. The overview (the cards and "Look closer"), then the four section pages (collections, dues, complaints, bank), each with
 * the page checks of `checkScreen`, the text-overlap check on every card and chart, and the drill-down of the Dues page.
 */
const widthOf = (page: Page): number => page.viewportSize()?.width ?? 0;
const wide = (page: Page): boolean => widthOf(page) >= 768;
const CARDS = "section[aria-label='Headline figures']";
const SLUGS = ["collections", "dues", "complaints", "bank"] as const;
const TITLES: Record<(typeof SLUGS)[number], RegExp> = {
  collections: /^Collections, October 2026$/,
  dues: /^Dues, all months$/,
  complaints: /^Complaints, October 2026$/,
  bank: /^Bank statement matching, last 30 days$/,
};

async function openOverview(page: Page, query = "?period=2026-10"): Promise<void> {
  await page.goto(`/staff/reports${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Committee report" })).toBeVisible();
}

async function openSection(page: Page, slug: (typeof SLUGS)[number], query = "?period=2026-10"): Promise<void> {
  await page.goto(`/staff/reports/${slug}${query}`);
  await expect(page.getByRole("heading", { level: 1, name: TITLES[slug] })).toBeVisible();
}

async function save(page: Page, locator: ReturnType<Page["locator"]> | null, name: string): Promise<void> {
  const file = path.join("docs", "screenshots", name);
  if (locator === null) await page.screenshot({ path: file, scale: "css", animations: "disabled" });
  else await locator.screenshot({ path: file, scale: "css", animations: "disabled" });
  expect(statSync(file).size, file).toBeLessThanOrEqual(MAX_BYTES);
}

const visibleFigureIds = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("figure svg[role='img']")]
      .filter((svg) => svg.getBoundingClientRect().width > 0 && getComputedStyle(svg).visibility !== "hidden")
      .map((svg) => (svg.getAttribute("aria-labelledby") ?? "").split(" ")[0].replace(/-title$/, "")),
  );

test.describe("the committee report at one width", () => {
  test.use({ storageState: authFile("meera") });

  test("the overview: one h1, the four cards, four Look closer rows of at least 56px, no Choose sections; the page checks", async ({ page }) => {
    const watch = watchPage(page);
    await openOverview(page);
    await expect(page.locator(`${CARDS} li`)).toHaveCount(4);
    const rows = page.locator("section[aria-labelledby='committee-look-closer'] li");
    await expect(rows).toHaveCount(4);
    for (const row of await rows.all()) {
      await expect(row.locator("a")).toHaveCount(1);
      expect((await row.locator("a").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
    }
    await expect(page.getByRole("button", { name: "Choose sections" })).toHaveCount(0);
    expect((await page.context().cookies()).some((c) => c.name === "committee_view")).toBe(false);
    await checkScreen(page, watch, "committee", "overview");
  });

  test("a phone's first screen holds the title, the month control and at least two whole headline cards; the whole overview is at most three screens", async ({ page }) => {
    test.skip(widthOf(page) !== 360, "the first-screen acceptance is for the 360 x 800 phone");
    await openOverview(page);
    const height = page.viewportSize()?.height ?? 0;
    const bottomOf = async (locator: ReturnType<Page["locator"]>) => {
      const box = await locator.boundingBox();
      return (box?.y ?? 0) + (box?.height ?? 0);
    };
    expect(await bottomOf(page.getByRole("heading", { level: 1 }))).toBeLessThanOrEqual(height);
    expect(await bottomOf(page.locator("#report-period"))).toBeLessThanOrEqual(height);
    const bottoms = await Promise.all((await page.locator(`${CARDS} > ul > li`).all()).map(bottomOf));
    const whole = bottoms.filter((bottom) => bottom <= height).length;
    console.log(`FIRST SCREEN 360x${height}: card bottoms ${bottoms.map(Math.round).join(", ")}; whole cards visible ${whole}`);
    expect(whole).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(3 * height);
  });

  test("the headline cards: no sparkline, one Met or Not met tag per goal card, a goal bar whose tick is at the goal, and no overlapping text; at 360px each card is at most 190px tall", async ({ page }) => {
    await openOverview(page);
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

  test("the Replies card's figure is the last value of its own 'Last six months' table, which lists only months with a figure", async ({ page }) => {
    await openOverview(page);
    const card = page.locator(`${CARDS} > ul > li`).nth(3);
    const value = (await card.locator("p.text-hero").innerText()).trim();
    await card.locator("details > summary").click();
    const rows = card.locator("details table tbody tr");
    expect((await rows.last().locator("td").innerText()).trim()).toBe(value);
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    expect(await rows.count()).toBeLessThanOrEqual(6);
  });

  test("close-ups of the overview and the cards", async ({ page }) => {
    await openOverview(page);
    if ([360, 1280].includes(widthOf(page))) await save(page, page.locator(CARDS), `committee-cards-after-${widthOf(page)}x800.png`);
    await save(page, null, `committee-overview-${widthOf(page)}x${widthOf(page) === 768 ? 1024 : 800}.png`);
    if (widthOf(page) === 360) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await save(page, null, "committee-overview-after-360x800.png");
    }
  });

  test("choosing a month changes the overview with no Show button", async ({ page }) => {
    await openOverview(page);
    await expect(page.getByRole("button", { name: "Show", exact: true })).toHaveCount(0);
    await page.locator("#report-period").selectOption("2026-09");
    await expect(page).toHaveURL(/period=2026-09/);
    await expect(page.getByRole("heading", { name: /Money collected for September/ })).toBeVisible();
  });

  for (const slug of SLUGS) {
    test(`the ${slug} page: back link, one h1 that takes the focus, no overflow, the page checks, no text overlap in any chart`, async ({ page }) => {
      const watch = watchPage(page);
      await openSection(page, slug);
      await expect(page.getByRole("link", { name: "Back to the committee report" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      for (const figure of await page.locator("figure:visible").all()) {
        await assertNoTextOverlap(figure.locator("svg[role='img']"), `${slug}: chart ${await figure.locator("figcaption").innerText()} at ${widthOf(page)}px`);
      }
      await checkScreen(page, watch, "committee", slug);
      if (widthOf(page) === 360) await save(page, null, `committee-${slug}-360x800.png`);
      if (widthOf(page) === 360 && slug !== "dues") await save(page, null, `committee-${slug}-after-360x800.png`);
      if (widthOf(page) === 1280 && (slug === "collections" || slug === "complaints")) await save(page, null, `committee-${slug}-after-1280x800.png`);
      if (widthOf(page) === 1280 && slug === "collections") await save(page, null, "committee-collections-1280x800.png");
      await page.getByRole("link", { name: "Back to the committee report" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Committee report" })).toBeVisible();
    });
  }

  test("an address that is not one of the four pages is a 404", async ({ page }) => {
    await page.goto("/staff/reports/money");
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Collections|Committee report/ })).toHaveCount(0);
  });

  test("the list of the report's pages exists from 1024px only, and marks the current page", async ({ page }) => {
    await openSection(page, "dues");
    const list = page.getByRole("navigation", { name: "Report pages" });
    if (widthOf(page) >= 1024) {
      await expect(list).toBeVisible();
      await expect(list.locator("[aria-current='page']")).toHaveText("Dues");
    } else {
      await expect(list).toBeHidden();
    }
  });

  test("the Collections page: the whole ledger, the bar and the two facts are on a phone's first screen, and Collected plus Still unpaid equals Billed", async ({ page }) => {
    await openSection(page, "collections");
    const ledger = page.locator("section[aria-labelledby='committee-ledger']");
    const facts = ledger.locator("ul").first();
    if (widthOf(page) === 360) expect(((await facts.boundingBox())?.y ?? 0) + ((await facts.boundingBox())?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
    const amount = async (label: string) => Number(((await ledger.locator(`dt:has-text("${label}") + dd`).innerText()).match(/[\d,]+/)?.[0] ?? "").replace(/,/g, ""));
    expect((await amount("Collected")) + (await amount("Still unpaid"))).toBe(await amount("Billed"));
    expect(await page.getByText(/principal/i).count()).toBe(0);
  });

  test("each visible visual has a title, a description and a table; below 768px the only visual is the monthly bars", async ({ page }) => {
    await openSection(page, "collections");
    expect((await visibleFigureIds(page)).sort()).toEqual((wide(page) ? ["curve", "monthly-columns"] : ["monthly-bars"]).sort());
    await openSection(page, "complaints");
    if (wide(page)) expect(await visibleFigureIds(page)).toEqual(["weekly"]);
    for (const slug of ["collections", "complaints"] as const) {
      await openSection(page, slug);
      for (const figure of await page.locator("figure:visible").all()) {
        const svg = figure.locator("svg[role='img']");
        await expect(svg.locator("title")).not.toBeEmpty();
        await expect(svg.locator("desc")).not.toBeEmpty();
        await expect(figure.locator("details > summary")).toHaveText("See the numbers behind this chart");
        await figure.locator("details > summary").click();
        await expect(figure.locator("table tbody tr").first()).toBeVisible();
      }
    }
  });

  test("an old inline address goes to the flats page; the flats page opens largest first, turns to oldest first, has ONE back link at the top, and its rows are one line of at most 56px", async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/staff/reports/dues?period=2026-10&bucket=over-90&sort=oldest");
    await expect(page).toHaveURL(/\/staff\/reports\/dues\/flats\?bucket=over-90&sort=oldest$/);
    await page.goto("/staff/reports?period=2026-10&bucket=over-90");
    await expect(page).toHaveURL(/\/staff\/reports\/dues\/flats\?bucket=over-90$/);
    const heading = page.getByRole("heading", { level: 1, name: /^\d+ flats owe ₹[\d.]+ (lakh|crore)$/ });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText(/^Over 90 days · as of 27 October 2026$/)).toBeVisible();
    await expect(page.getByText("Flat codes only.")).toBeVisible();
    const sort = page.getByRole("navigation", { name: "Order of the flats" });
    await expect(sort.getByRole("link", { name: "Largest first" })).toHaveAttribute("aria-current", "true");
    const rows = page.locator("main ul > li");
    await expect(rows.first()).toBeVisible();
    const amounts = await rows.evaluateAll((els) => els.map((el) => Number(/₹([\d,]+)/.exec((el as HTMLElement).innerText)?.[1].replace(/,/g, ""))));
    expect(amounts.length).toBeGreaterThan(5);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      expect(box?.height ?? 0).toBeLessThanOrEqual(56);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
    await expect(page.getByText(/^Showing \d+ of \d+$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to dues" })).toHaveCount(1);
    await expect(page.getByText(/Close this list|Back to age groups/)).toHaveCount(0);
    await checkScreen(page, watch, "committee", "flats");
    await assertNoTextOverlap(page.locator("main"), `the flats page at ${widthOf(page)}px`);
    if (widthOf(page) === 360) await save(page, null, "committee-dues-flats-after-360x800.png");
    const [first, second] = await sort.getByRole("link").all();
    for (const link of [first, second]) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("none");
    }
    expect(await first.evaluate((el) => getComputedStyle(el).fontWeight)).toBe(await second.evaluate((el) => getComputedStyle(el).fontWeight));
    await second.click();
    await expect(page).toHaveURL(/sort=oldest/);
    await expect(sort.getByRole("link", { name: "Oldest first" })).toHaveAttribute("aria-current", "true");
    await expect(heading).toBeFocused();
    await page.getByRole("link", { name: "Back to dues" }).click();
    await expect(page).toHaveURL(/\/staff\/reports\/dues$/);
  });

  test("tapping an age group's link opens the flats page of that group", async ({ page }) => {
    await openSection(page, "dues");
    await page.getByRole("link", { name: /^See the flats: 31 to 60 days/ }).click();
    await expect(page).toHaveURL(/\/staff\/reports\/dues\/flats\?bucket=31-60$/);
    const heading = page.getByRole("heading", { level: 1, name: /^\d+ flats owe / });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
  });

  test("hostile values fall back: an unknown group goes back to Dues, an unknown order is largest first, an unknown tower order is the most owed first", async ({ page }) => {
    await page.goto("/staff/reports/dues/flats?bucket=%3Cscript%3E");
    await expect(page).toHaveURL(/\/staff\/reports\/dues$/);
    await page.goto("/staff/reports/dues/flats?bucket=31-60&sort=%3Cscript%3E");
    await expect(page.getByRole("link", { name: "Largest first" })).toHaveAttribute("aria-current", "true");
    await page.goto("/staff/reports/dues/towers?sort=%3Cscript%3E");
    await expect(page.getByRole("link", { name: "Most owed first" })).toHaveAttribute("aria-current", "true");
  });

  test("the Dues page: no inline list of flats, at most five tower rows with 'All 28 towers' as its last element, an age table of at most four columns on a phone, and no overflow", async ({ page }) => {
    await openSection(page, "dues");
    await expect(page.locator("main").getByText(/T\d\d-\d{4}/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Show \d+ more/ })).toHaveCount(0);
    const towers = page.locator("section[aria-labelledby='committee-towers']");
    expect(await towers.locator("tbody tr").count()).toBeLessThanOrEqual(5);
    const link = towers.getByRole("link", { name: /^All \d+ towers$/ });
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
    expect(await towers.evaluate((el) => (el.lastElementChild as HTMLElement).tagName)).toBe("A");
    await expect(page.locator("main").getByText(/month chosen|does not change this block/)).toHaveCount(0);
    await expect(page.locator("#report-period")).toHaveCount(0);
    await page.locator("section[aria-labelledby='committee-age'] details > summary").click();
    const visibleHeads = await page.locator("section[aria-labelledby='committee-age'] table th[scope='col']").evaluateAll((ths) => ths.filter((th) => th.getBoundingClientRect().width > 0).length);
    expect(visibleHeads).toBe(widthOf(page) >= 768 ? 6 : 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await assertNoTextOverlap(page.locator("main"), `the Dues page at ${widthOf(page)}px`);
    if (widthOf(page) === 360) await save(page, null, "committee-dues-after-360x800.png");
    if (widthOf(page) === 1280) await save(page, null, "committee-dues-after-1280x800.png");
  });

  test("the towers page: reached from 'All 28 towers', one table of all towers whose totals row is Total owed, four columns on a phone, two sort options, one back link", async ({ page }) => {
    const watch = watchPage(page);
    await openSection(page, "dues");
    const totalOwed = (await page.locator("section[aria-labelledby='committee-total'] .tnum").first().innerText()).trim();
    await page.getByRole("link", { name: /^All \d+ towers$/ }).click();
    await expect(page).toHaveURL(/\/staff\/reports\/dues\/towers$/);
    const heading = page.getByRole("heading", { level: 1, name: "Towers, all months" });
    await expect(heading).toBeFocused();
    await expect(page.getByText("As of 27 October 2026")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(1);
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(20);
    const visibleHeads = await page.locator("table th[scope='col']").evaluateAll((ths) => ths.filter((th) => th.getBoundingClientRect().width > 0).map((th) => th.textContent));
    expect(visibleHeads).toEqual(widthOf(page) >= 768 ? ["Tower", "Owed", "Flats owing", "Over 90 days", "Unpaid bills", "Late fees"] : ["Tower", "Owed", "Flats owing", "Over 90 days"]);
    const lastOwed = await page.locator("tbody tr").last().locator("td").first().innerText();
    expect(lastOwed.replace(/[^\d]/g, ""), "the totals row is Total owed").toBe(totalOwed.replace(/[^\d]/g, ""));
    await expect(page.getByRole("link", { name: "Back to dues" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Most owed first" })).toHaveAttribute("aria-current", "true");
    await checkScreen(page, watch, "committee", "towers");
    await assertNoTextOverlap(page.locator("main"), `the towers page at ${widthOf(page)}px`);
    if (widthOf(page) === 360) await save(page, null, "committee-dues-towers-after-360x800.png");
    if (widthOf(page) === 1280) await save(page, null, "committee-dues-towers-after-1280x800.png");
    await page.getByRole("link", { name: "Tower number" }).click();
    await expect(page).toHaveURL(/sort=tower$/);
    await expect(page.getByRole("link", { name: "Tower number" })).toHaveAttribute("aria-current", "true");
    expect((await page.locator("tbody tr").first().locator("th").innerText()).trim()).toMatch(/^Tower \d+$/);
    await page.getByRole("link", { name: "Back to dues" }).click();
    await expect(page).toHaveURL(/\/staff\/reports\/dues$/);
  });

  test("keyboard: on the flats page the first Tab reaches the back link, then the two sort options, in that order; Enter follows a link", async ({ page }) => {
    await page.goto("/staff/reports/dues/flats?bucket=31-60");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Back to dues" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Largest first" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Oldest first" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/sort=oldest/);
  });

  test("the strip and the Complaints page give the same count of open safety complaints that nobody has seen: the all-months row shows only when it differs from the month's line", async ({ page }) => {
    await openOverview(page);
    const strip = page.getByRole("status").filter({ hasText: "not yet seen by the duty manager" });
    const k = (await strip.count()) > 0 ? Number(/(\d[\d,]*) safety complaints? (is|are)/.exec(await strip.innerText())?.[1].replace(/,/g, "")) : 0;
    await openSection(page, "complaints");
    const safety = page.locator("section[aria-labelledby='committee-safety']");
    const valueOf = async (label: string) => {
      const row = safety.locator("dt").filter({ hasText: new RegExp(`^\\+?(plus )?${label}$`) });
      return (await row.count()) === 0 ? null : Number((await row.locator("xpath=following-sibling::dd").innerText()).replace(/,/g, ""));
    };
    const month = await valueOf("Open, not yet seen");
    const all = await valueOf("Open, not yet seen, all months");
    expect(all === null ? month ?? 0 : all, "the page and the strip say the same number").toBe(k);
    if (all !== null) expect(all).not.toBe(month ?? 0);
  });

  test("no value wraps: every figure value of every committee page is on one line (at 360px too)", async ({ page }) => {
    for (const slug of SLUGS) {
      await openSection(page, slug);
      const wrapped = await page.evaluate(() =>
        [...document.querySelectorAll("main dd")]
          .filter((dd) => {
            const range = document.createRange();
            range.selectNodeContents(dd);
            return new Set([...range.getClientRects()].map((r) => Math.round(r.top / 4))).size > 1;
          })
          .map((dd) => (dd.textContent ?? "").slice(0, 30)),
      );
      expect(wrapped, `${slug}: values that wrap`).toEqual([]);
    }
  });

  test("each page has one expander of definitions, closed, that opens in place with its summary at least 48px, and no About block", async ({ page }) => {
    for (const slug of SLUGS) {
      await openSection(page, slug);
      const expander = page.locator("details[data-definitions]");
      await expect(expander).toHaveCount(1);
      const summary = expander.locator("summary");
      expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
      await expect(summary).toHaveText("What do these mean?");
      await summary.click();
      await expect(expander.locator("li").first()).toBeVisible();
      await assertNoTextOverlap(expander, `${slug}: the open expander at ${widthOf(page)}px`);
    }
    await openOverview(page);
    await expect(page.locator("details[data-definitions]")).toHaveCount(1);
    await expect(page.getByText(/About these numbers|What these words mean/)).toHaveCount(0);
  });

  test("at 150 percent zoom on a phone (a 240 px wide screen) no page overflows sideways, with every table open", async ({ page }) => {
    test.skip(widthOf(page) !== 360, "the zoom pass is for the phone");
    await page.setViewportSize({ width: 240, height: 533 });
    for (const slug of SLUGS) {
      await openSection(page, slug);
      await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => (d.open = true)));
      const wider = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth, elements: [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest("[class*='overflow-x-auto']")).slice(0, 5).map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 30)}`) }));
      expect(wider.elements, slug).toEqual([]);
      expect(wider.page, slug).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("the committee pages need reports:view", () => {
  test.use({ storageState: authFile("kavita") });

  test("a person without reports:view is sent away from the overview and from every section page", async ({ page }) => {
    for (const address of ["/staff/reports", ...SLUGS.map((slug) => `/staff/reports/${slug}`)]) {
      await page.goto(address);
      await expect(page).toHaveURL(/\/forbidden/);
    }
  });
});
