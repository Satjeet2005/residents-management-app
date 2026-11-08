import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../helpers/people";

/**
 * D185, the clutter budget of the call-first Emergency sheet, measured in the browser at 360 x 800 for a society with a duty manager number: the sheet needs no inner
 * scrolling; exactly three controls (Close, Call duty manager, Raise a complaint); the Call button's bottom edge is in the top 55 percent of the screen; exactly one filled
 * control; every control at least 48 px with at least 8 px between neighbours; nothing underlined that is not a link; axe has no serious or critical violation. The states
 * with no duty manager number and with an emergency services number are rendered by tests/ui/emergency-sheet.test.ts (the settings are the society's, not the browser's).
 * Also writes the AFTER screenshots of docs/screenshots/emergency-sheet-after-*.png.
 */
test.skip(({ viewport }) => viewport?.width !== 360, "one run is enough: this spec sets its own viewports");
test.use({ storageState: authFile("neeraj") });

const SIZES = [
  { name: "360x800", width: 360, height: 800, phone: true },
  { name: "360x500", width: 360, height: 500, phone: true },
  { name: "1280", width: 1280, height: 800, phone: false },
] as const;

async function openSheet(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Emergency" }).click();
  await expect(page.getByRole("dialog", { name: "Emergency help" })).toBeVisible();
}

for (const size of SIZES) {
  test(`the Emergency sheet at ${size.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: authFile("neeraj"), viewport: { width: size.width, height: size.height }, isMobile: size.phone, hasTouch: size.phone });
    const page = await context.newPage();
    await openSheet(page);
    const dialog = page.getByRole("dialog", { name: "Emergency help" });
    await page.screenshot({ path: `docs/screenshots/emergency-sheet-after-${size.name}.png`, scale: "css" });
    if (size.name === "360x800") {
      const m = await dialog.evaluate((el) => {
        const body = el.querySelector(".overflow-y-auto") as HTMLElement;
        const controls = [...el.querySelectorAll("a[href], button")].map((c) => {
          const r = c.getBoundingClientRect();
          return { text: (c.textContent ?? "").trim(), top: r.top, bottom: r.bottom, width: r.width, height: r.height, filled: getComputedStyle(c).backgroundColor !== "rgba(0, 0, 0, 0)" && c.className.includes("bg-accent") };
        });
        const underlined = [...el.querySelectorAll("*")].filter((n) => getComputedStyle(n).textDecorationLine.includes("underline") && n.closest("a") === null).length;
        return { scrollable: body.scrollHeight > body.clientHeight + 1, controls, underlined, plainLinkLooks: [...el.querySelectorAll("p, h2, h3")].filter((n) => n.className.includes("underline")).length };
      });
      console.log("emergency sheet 360x800:", JSON.stringify({ controls: m.controls.map((c) => `${c.text} ${Math.round(c.width)}x${Math.round(c.height)} bottom ${Math.round(c.bottom)}`), scrollable: m.scrollable }));
      expect(m.scrollable, "no inner scrolling").toBe(false);
      expect(m.controls.map((c) => c.text)).toEqual(["Close", "Call duty manager", "Raise a complaint"]);
      expect(m.controls.filter((c) => c.filled)).toHaveLength(1);
      const call = m.controls.find((c) => c.text === "Call duty manager");
      expect(call?.bottom ?? 9999).toBeLessThanOrEqual(0.55 * 800);
      for (const [i, c] of m.controls.entries()) {
        expect(c.height, `${c.text} is at least 48 px tall`).toBeGreaterThanOrEqual(48);
        expect(c.width, `${c.text} is at least 48 px wide`).toBeGreaterThanOrEqual(48);
        if (i > 0) expect(c.top - m.controls[i - 1].bottom, `${c.text} is at least 8 px from the control above`).toBeGreaterThanOrEqual(8);
      }
      expect(m.underlined).toBe(0);
      expect(m.plainLinkLooks).toBe(0);
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    }
    await context.close();
  });
}
