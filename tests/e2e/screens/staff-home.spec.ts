import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { DEMO_NOW } from "../../../src/domain/seed/types";
import { checkScreen, watchPage } from "../helpers/checks";
import { type Person, authFile } from "../helpers/people";

/**
 * The staff home (D186 to D188) in a browser, for the five seeded staff accounts. At 360 x 800 the first screen shows the h1 role title, the "Signed in as" line and the
 * first card's primary link; the controls are few; the counts equal SQL written here (the scratch database, read with the connection string of the run); the strips show
 * only for a count above zero and only for the person who holds the permission (the state is made through the app's own routes, as Priya and Rohit); one filled
 * control; Sign out is not full width; no horizontal overflow at 360, 768 and 1280; the keyboard goes strips, links, the list, Sign out. Writes the AFTER screenshots.
 * It runs last in the chain because it adds an import and a danger report.
 */
test.skip(({ viewport }) => viewport?.width !== 360, "this spec sets its own viewports");
test.describe.configure({ mode: "serial" });

const ACCOUNTS: { person: Person; name: string; title: string; maxControls: number }[] = [
  { person: "priya", name: "Priya Nair", title: "Accountant", maxControls: 4 },
  { person: "rahul", name: "Rahul Menon", title: "Accountant and approver", maxControls: 5 },
  { person: "meera", name: "Meera Kapoor", title: "Committee", maxControls: 3 },
  { person: "kavita", name: "Kavita Rao", title: "Complaints manager", maxControls: 4 },
  { person: "sanjay", name: "Sanjay Pawar", title: "Duty manager", maxControls: 5 },
];

async function sql<T>(text: string, params: unknown[] = []): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = "/township_seed_scratch";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return (await client.query(text, params)).rows[0] as T;
  } finally {
    await client.end();
  }
}

const idOf = (phone: string) => sql<{ id: string }>("SELECT id::text FROM users WHERE phone = $1", [phone]);
const PHONES: Record<Person, string> = { priya: "5000000001", rahul: "5000000002", meera: "5000000003", kavita: "5000000004", sanjay: "5000000005" } as Record<Person, string>;

async function open(browser: import("@playwright/test").Browser, baseURL: string | undefined, person: Person, width: number, height: number) {
  const phone = width < 1000;
  const context = await browser.newContext({ baseURL, storageState: authFile(person), viewport: { width, height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const page = await context.newPage();
  await page.goto("/staff");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return { context, page };
}

const controls = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main a[href], main button, main summary")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ text: (el.textContent ?? "").trim(), bottom: el.getBoundingClientRect().bottom, width: el.getBoundingClientRect().width, tag: el.tagName, filled: el.className.includes("bg-accent") })),
  );

test("make the state: a request waiting for approval (Priya marks a large credit as not maintenance) and an unseen danger report (Rohit)", async ({ browser, baseURL }) => {
  const priya = await browser.newContext({ baseURL, storageState: authFile("priya") });
  const csv = `Txn Date,Narration,Credit,Debit\n2026-10-27,UPI/920000000001/HOME CHECK/maint,15000.00,\n`;
  const imported = await priya.request.post("/api/statements", { data: { filename: "staff-home-check.csv", csv } });
  expect(imported.status(), await imported.text()).toBe(200);
  const { importId } = (await imported.json()) as { importId: string };
  const rows = (await (await priya.request.get(`/api/statements/${importId}/rows?lane=NEEDS_YOU&limit=50`)).json()) as { items: { id: string; version: number }[] };
  const row = rows.items[0];
  // A credit at or above the threshold that is marked "not maintenance" waits for a second approver, whatever the flats owe.
  const ignored = await priya.request.post(`/api/bank-rows/${row.id}/ignore`, { data: { reason: "A deposit for the hall, not maintenance", expectedVersion: row.version } });
  expect(ignored.status(), await ignored.text()).toBe(200);
  expect(((await ignored.json()) as { status: string }).status).toBe("AWAITING_APPROVAL");
  await priya.close();
  const rohit = await browser.newContext({ baseURL, storageState: authFile("rohit") });
  const danger = await rohit.request.post("/api/complaints", { data: { body: "Gas smell near the tower 2 lift lobby", declaredDanger: true } });
  expect([200, 201]).toContain(danger.status());
  await rohit.close();
});

for (const account of ACCOUNTS) {
  test(`${account.title}: the first screen at 360 x 800, the numbers, the controls`, async ({ browser, baseURL }) => {
    const { context, page } = await open(browser, baseURL, account.person, 360, 800);
    const watch = watchPage(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(account.title);
    await expect(page.getByText(`Signed in as ${account.name}`)).toBeVisible();
    const list = await controls(page);
    const firstPrimary = list.find((c) => c.tag === "A");
    expect(firstPrimary, "a first card link").toBeDefined();
    const primary = list.find((c) => c.filled);
    expect(primary?.bottom ?? 9999, "the first card's filled link is inside the first screen").toBeLessThanOrEqual(800);
    expect(list.length, `controls: ${list.map((c) => c.text).join(" | ")}`).toBeLessThanOrEqual(account.maxControls);
    expect(list.filter((c) => c.filled)).toHaveLength(1);
    const signOut = list.find((c) => c.text === "Sign out");
    expect(signOut?.width ?? 999).toBeLessThan(300);
    const now = new Date(DEMO_NOW).toISOString();

    if (account.person === "priya" || account.person === "rahul") {
      const totals = await sql<{ q: number; a: number }>(`SELECT (SELECT count(*) FROM bank_rows WHERE state = 'QUEUED')::int AS q, (SELECT count(*) FROM bank_rows WHERE state = 'AWAITING_APPROVAL')::int AS a`);
      await expect(page.getByText(`${totals.q} need a person, ${totals.a} waiting for approval`)).toBeVisible();
      expect(totals.a).toBeGreaterThanOrEqual(1);
    }
    if (account.person === "kavita" || account.person === "sanjay") {
      const { id } = await idOf(PHONES[account.person]);
      const counts = await sql<{ needs: number; overdue: number }>(
        `SELECT (count(*) FILTER (WHERE c.status <> 'CLOSED' AND ((c.safety_flag AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack')) OR c.assignee_id IS NULL OR (c.needs_review AND c.status = 'NEW') OR (c.assignee_id = $1::uuid AND ((c.response_due_at < $2::timestamptz AND c.first_response_at IS NULL) OR c.status = 'REOPENED')))))::int AS needs,
                (count(*) FILTER (WHERE c.status <> 'CLOSED' AND c.response_due_at < $2::timestamptz AND c.first_response_at IS NULL))::int AS overdue FROM complaints c`,
        [id, now],
      );
      await expect(page.getByText(`${counts.needs} need action, ${counts.overdue} overdue`)).toBeVisible();
    }
    // The safety strip is for the duty manager only; the approvals strip for an approver only, and it excludes the requests of that person.
    const unseen = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM complaints c WHERE c.safety_flag AND c.status <> 'CLOSED' AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack')`);
    const safetyStrip = page.getByRole("link", { name: /not yet seen by the duty manager/ });
    if (account.person === "sanjay") {
      expect(unseen.n).toBeGreaterThanOrEqual(1);
      await expect(safetyStrip).toHaveText(unseen.n === 1 ? "1 safety complaint is open and not yet seen by the duty manager." : `${unseen.n} safety complaints are open and not yet seen by the duty manager.`);
      expect(await safetyStrip.getAttribute("href")).toBe("/staff/complaints?view=safety");
    } else {
      await expect(safetyStrip).toHaveCount(0);
    }
    const approvalsStrip = page.getByRole("link", { name: /waiting for your approval/ });
    if (account.person === "rahul") {
      const { id } = await idOf(PHONES.rahul);
      const mine = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bank_rows r WHERE r.state = 'AWAITING_APPROVAL' AND NOT EXISTS (SELECT 1 FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' AND m.decided_by_id = $1::uuid)`, [id]);
      expect(mine.n).toBeGreaterThanOrEqual(1);
      await expect(approvalsStrip).toHaveText(mine.n === 1 ? "1 request is waiting for your approval." : `${mine.n} requests are waiting for your approval.`);
      expect(await approvalsStrip.getAttribute("href")).toMatch(/\/staff\/reconciliation\/[0-9a-f-]{36}\?lane=awaiting-approval/);
    } else {
      await expect(approvalsStrip).toHaveCount(0);
    }
    // Nothing on the page names a resident, a phone or a narration.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\b5\d{9}\b|UPI\/|Neeraj|Swati|Rohit/);

    await page.screenshot({ path: `docs/screenshots/staff-home-after-${account.person}-360x800.png`, scale: "css" });
    await checkScreen(page, watch, "staff-home", account.person);
    await context.close();
  });
}

test("the keyboard goes through the strips, the links, the list and Sign out, in that order (Rahul)", async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL, "rahul", 360, 800);
  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim().slice(0, 40)));
    if (order[order.length - 1] === "Sign out") break;
  }
  expect(order[0]).toMatch(/waiting for your approval/);
  expect(order.slice(1)).toEqual(["Open reconciliation", "Upload a new statement", "What you can do here", "Sign out"]);
  await context.close();
});

test("the permissions list is closed until opened, and Sign out is a small button (Meera)", async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL, "meera", 360, 800);
  await expect(page.getByText("View reports")).toBeHidden();
  await page.getByText("What you can do here").click();
  await expect(page.getByText("View reports")).toBeVisible();
  await expect(page.getByRole("link", { name: "Staff home" })).toHaveCount(0);
  await context.close();
});

for (const size of [{ w: 360, h: 800 }, { w: 768, h: 1024 }, { w: 1280, h: 800 }]) {
  test(`no horizontal overflow, axe clean and one filled control at ${size.w} (Priya, Rahul)`, async ({ browser, baseURL }) => {
    for (const person of ["priya", "rahul"] as const) {
      const { context, page } = await open(browser, baseURL, person, size.w, size.h);
      const watch = watchPage(page);
      if (person === "priya" && size.w === 1280) await page.screenshot({ path: "docs/screenshots/staff-home-after-priya-1280.png", scale: "css" });
      await checkScreen(page, watch, "staff-home", `${person}-${size.w}`);
      await context.close();
    }
  });
}

test("a staff page other than the home has the back link, named for a screen reader", async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL, "kavita", 360, 800);
  await page.goto("/staff/complaints");
  const back = page.getByRole("link", { name: "Back to staff home" });
  await expect(back).toBeVisible();
  await expect(back).toHaveText("Staff home");
  await back.click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole("link", { name: "Back to staff home" })).toHaveCount(0);
  await context.close();
});
