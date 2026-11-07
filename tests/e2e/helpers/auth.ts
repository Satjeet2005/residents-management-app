import { type Page } from "@playwright/test";

/** "Try again in 25 seconds." or "Try again in 1 minute." as a number of seconds, or null when the text is not that. */
export function waitSeconds(text: string): number | null {
  const match = /Try again in (\d+) (second|seconds|minute|minutes)\b/.exec(text);
  if (match === null) return null;
  return Number(match[1]) * (match[2].startsWith("minute") ? 60 : 1);
}

/**
 * Logs in through the REAL login page with a demo phone: the phone, "Send code", the code from the demo banner ("Demo mode: your code is 123456"), "Log in". It
 * returns where the app sent the person (a resident to the Home, staff to /staff). The app asks a phone to wait between codes; when it says "Try again in N
 * seconds" this waits that long and asks again, so a spec never depends on how fast the others ran. It never prints the code.
 */
export async function loginThroughThePage(page: Page, phone: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  const banner = page.getByText(/Demo mode: your code is \d{6}/);
  const wait = page.getByText(/Try again in \d+ (second|seconds|minute|minutes)/);
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole("button", { name: "Send code" }).click();
    await banner.or(wait).first().waitFor();
    if (await banner.isVisible()) break;
    const seconds = waitSeconds(await wait.first().innerText()) ?? 30;
    await page.waitForTimeout((seconds + 1) * 1000);
  }
  const code = /(\d{6})/.exec(await banner.innerText())?.[1];
  if (code === undefined) throw new Error("the demo code banner has no code");
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return new URL(page.url()).pathname;
}
