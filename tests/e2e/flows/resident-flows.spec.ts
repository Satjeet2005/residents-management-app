import { expect, test } from "@playwright/test";
import { loginThroughThePage } from "../helpers/auth";
import { PHONES, authFile } from "../helpers/people";

/**
 * T15 Part 3, the resident flows with real clicks, on a phone (360 x 800). Each flow uses its own flat so that the flows do not depend on their order: Anil logs in and out, Rohit
 * copies the payment note, Aamir's payment fails on the demo page, Swati's succeeds and she then raises a danger report whose alert 1a becomes 1b when the duty manager has seen it,
 * and Neeraj raises a normal complaint. The demo payment page is the mock gateway (D-demo): nothing is charged.
 */
test.describe.configure({ mode: "serial" });

test("login and logout through the real pages", async ({ page }) => {
  const landed = await loginThroughThePage(page, PHONES.anil);
  expect(landed).toBe("/");
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/");
  await page.waitForURL(/\/login/);
});

test.describe("copy the payment note", () => {
  test.use({ storageState: authFile("rohit"), permissions: ["clipboard-read", "clipboard-write"] });

  test("the button copies the flat code and says Copied", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /See what makes up this amount/ }).click();
    await page.getByRole("button", { name: "Copy payment note" }).click();
    await expect(page.getByText("Copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("T15-0902");
  });
});

test.describe("pay on the demo page", () => {
  test.describe("a payment that fails", () => {
    test.use({ storageState: authFile("aamir") });

    test("no money is taken and the Home says so", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /^Pay .*₹/ }).first().click();
      await page.waitForURL(/\/pay\/mock\//);
      await page.getByRole("button", { name: "Payment fails, no money taken" }).click();
      // The mock gateway sends the person back to the Home, which says what happened.
      await expect(page.getByText("That payment didn't go through. No money left your account.")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Pay .*₹/ }).first()).toBeVisible();
    });
  });

  test.describe("a payment that succeeds", () => {
    test.use({ storageState: authFile("swati") });

    test("the Home then has no dues", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /^Pay .*₹/ }).first().click();
      await page.waitForURL(/\/pay\/mock\//);
      await page.getByRole("button", { name: "Pay successfully" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/pay/"));
      await expect(page.getByText(/No dues/).first()).toBeVisible();
    });
  });
});

test.describe("complaints", () => {
  test.describe("a normal complaint", () => {
    test.use({ storageState: authFile("neeraj") });

    test("the danger answer cannot be skipped, and 'No' sends the complaint", async ({ page }) => {
      await page.goto("/complaints/new");
      await page.getByLabel("What is the problem?").fill("The bench in the garden has a loose plank");
      await page.getByRole("button", { name: "Send complaint" }).click();
      await expect(page.getByText("Choose Yes or No.")).toBeVisible();
      await expect(page).toHaveURL(/\/complaints\/new/);
      await page.getByRole("radio", { name: "No" }).check();
      await page.getByRole("button", { name: "Send complaint" }).click();
      await expect(page.getByText("We have your complaint. You can follow it here.")).toBeVisible();
    });
  });

  test.describe("a danger complaint", () => {
    test.use({ storageState: authFile("swati") });

    test("Yes shows the call link, the Home shows alert 1a, then 1b once the duty manager has seen it", async ({ page, browser, baseURL }) => {
      await page.goto("/complaints/new");
      await page.getByLabel("What is the problem?").fill("A railing on the third floor stairs has come loose");
      await page.getByRole("radio", { name: "Yes" }).check();
      await expect(page.getByRole("link", { name: "Call duty manager" })).toBeVisible();
      await page.getByRole("button", { name: "Send complaint" }).click();
      await expect(page.getByText("Your report has gone to the duty manager.")).toBeVisible();
      await page.goto("/");
      await expect(page.getByText("Your report has gone to the duty manager")).toBeVisible();
      await expect(page.getByRole("link", { name: "Call duty manager" })).toBeVisible();

      const duty = await browser.newContext({ storageState: authFile("sanjay"), baseURL });
      const sanjay = await duty.newPage();
      await sanjay.goto("/staff/complaints?lane=safety");
      await sanjay.getByRole("link", { name: /railing on the third floor/ }).first().click();
      await sanjay.getByRole("button", { name: "I have seen this" }).click();
      await expect(sanjay.getByText(/Seen by the duty manager/).first()).toBeVisible();
      await duty.close();

      await page.goto("/");
      await expect(page.getByText("The duty manager has seen your report")).toBeVisible();
    });
  });
});
