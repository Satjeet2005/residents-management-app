import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../helpers/people";

/**
 * D184: a sheet owns the scroll. For three sheets (the resident Emergency sheet, the resident dues sheet, the staff complaints views sheet) at 360 x 500: open it,
 * scroll INSIDE it with the mouse wheel and then with a touch swipe (the DevTools protocol's Input.dispatchTouchEvent on the touch-emulated phone), and the page
 * behind has not moved (a button is clicked with dispatchEvent, so that Playwright does not scroll the page first) while the sheet's own scroll position has. Closing restores the exact scroll position and removes the overflow styles. Three open and close
 * rounds leave the lock off. At 1280 the document's client width is the same open and closed (no layout shift).
 */
const PAGE_Y = 180;

async function pageState(page: Page) {
  return page.evaluate(() => ({
    y: Math.round(window.scrollY),
    htmlOverflow: document.documentElement.style.overflow,
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    clientWidth: document.documentElement.clientWidth,
  }));
}

const sheetScroll = (page: Page) =>
  page.evaluate(() => {
    const body = document.querySelector("dialog[open] .overflow-y-auto") as HTMLElement | null;
    return body === null ? null : { top: Math.round(body.scrollTop), scrollable: body.scrollHeight > body.clientHeight + 1 };
  });

type Opener = { name: string; open: (page: Page) => Promise<void>; dialogName: string };

async function scrollInside(page: Page, how: "wheel" | "touch"): Promise<void> {
  const box = await page.locator("dialog[open] .overflow-y-auto").boundingBox();
  if (box === null) throw new Error("the sheet has no scroll container");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (how === "wheel") {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 240);
  } else {
    // A real touch swipe through the protocol (finger moves up by 200 px in ten steps). Input.synthesizeScrollGesture with a touch source did not scroll even the sheet in this
    // Chromium (0 px of 240 asked, measured), so the touch events themselves are sent.
    const client = await page.context().newCDPSession(page);
    const from = y + 100;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
    for (let step = 1; step <= 10; step++) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from - step * 20 }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  }
  await page.waitForTimeout(600);
}

async function roundTrip(page: Page, opener: Opener) {
  await page.evaluate((y) => window.scrollTo(0, y), PAGE_Y);
  const before = await pageState(page);
  expect(before.y).toBeGreaterThan(0);
  await opener.open(page);
  await expect(page.getByRole("dialog", { name: opener.dialogName })).toBeVisible();
  await page.evaluate(() => {
    (document.querySelector("dialog[open] .overflow-y-auto") as HTMLElement).scrollTop = 0;
  });
  const locked = await pageState(page);
  expect(locked.htmlOverflow).toBe("hidden");
  expect(locked.bodyPosition).toBe("fixed");
  for (const how of ["wheel", "touch"] as const) {
    const sheetBefore = await sheetScroll(page);
    expect(sheetBefore?.scrollable, `${opener.name}: the sheet must be taller than the 500 px screen to scroll`).toBe(true);
    await scrollInside(page, how);
    const sheetAfter = await sheetScroll(page);
    const during = await pageState(page);
    expect(sheetAfter?.top, `${opener.name}: ${how} scrolled the sheet`).toBeGreaterThan(sheetBefore?.top ?? 0);
    expect(during.bodyTop, `${opener.name}: ${how} did not move the page`).toBe(`-${before.y}px`);
    expect(during.htmlOverflow).toBe("hidden");
    await page.evaluate(() => {
      const body = document.querySelector("dialog[open] .overflow-y-auto") as HTMLElement;
      body.scrollTop = 0;
    });
  }
  // Past the end of the sheet the scroll must not chain to the page either.
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(300);
  expect((await pageState(page)).bodyTop, `${opener.name}: scrolling past the end did not move the page`).toBe(`-${before.y}px`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await pageState(page)).bodyPosition).toBe("");
  const after = await pageState(page);
  expect(after.y).toBe(before.y);
  expect(after.htmlOverflow).toBe("");
  expect(after.bodyPosition).toBe("");
  expect(after.bodyTop).toBe("");
}

test.describe("resident sheets at 360 x 500", () => {
  test.skip(({ viewport }) => viewport?.width !== 360, "phone only");
  test.use({ storageState: authFile("swati") });
  const emergency: Opener = { name: "Emergency", dialogName: "Emergency help", open: (page) => page.getByRole("button", { name: "Emergency" }).dispatchEvent("click") };
  const dues: Opener = { name: "dues", dialogName: "Your dues", open: (page) => page.getByRole("button", { name: /See what makes up this amount/ }).dispatchEvent("click") };

  for (const opener of [emergency, dues]) {
    test(`${opener.name} sheet: scrolling inside does not move the page; three rounds`, async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "T12-0408" })).toBeVisible();
      for (let round = 0; round < 3; round++) await roundTrip(page, opener);
    });
  }
});

test.describe("staff sheet at 360 x 500", () => {
  test.skip(({ viewport }) => viewport?.width !== 360, "phone only");
  test.use({ storageState: authFile("kavita") });
  test("the complaints views sheet: scrolling inside does not move the page; three rounds", async ({ page }) => {
    await page.goto("/staff/complaints?view=open");
    await expect(page.getByRole("button", { name: /^View: / })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const views: Opener = { name: "views", dialogName: "Choose a view", open: (p) => p.getByRole("button", { name: /^View: / }).dispatchEvent("click") };
    for (let round = 0; round < 3; round++) await roundTrip(page, views);
  });
});

test.describe("no layout shift at 1280 x 500", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop only");
  test.use({ storageState: authFile("swati") });
  test("opening and closing a sheet leaves the document width and the scroll position as they were", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "T12-0408" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 120));
    const before = await pageState(page);
    await page.getByRole("button", { name: "Emergency" }).dispatchEvent("click");
    await expect(page.getByRole("dialog", { name: "Emergency help" })).toBeVisible();
    const open = await pageState(page);
    expect(open.clientWidth).toBe(before.clientWidth);
    expect(open.bodyTop).toBe(`-${before.y}px`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await pageState(page)).bodyPosition).toBe("");
    const after = await pageState(page);
    expect(after.clientWidth).toBe(before.clientWidth);
    expect(after.y).toBe(before.y);
  });
});
