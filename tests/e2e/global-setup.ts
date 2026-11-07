import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { loginThroughThePage } from "./helpers/auth";
import { PHONES, SESSION_PEOPLE, authFile } from "./helpers/people";

/**
 * Opens a session for each person the specs use, ONCE, through the real login page (the demo code banner), and saves the browser state under test-results/auth.
 * The specs then start logged in; the login and logout spec does its own login with a phone that is not in this list.
 */
export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  mkdirSync("test-results/auth", { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const person of SESSION_PEOPLE) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await loginThroughThePage(page, PHONES[person]);
      await context.storageState({ path: authFile(person) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
