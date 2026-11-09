import { expect, test, type Page } from "@playwright/test";
import { DEMO_NOW } from "../../../src/domain/seed/types";
import { checkScreen, watchPage } from "../helpers/checks";
import { loginThroughThePage } from "../helpers/auth";
import { PHONES, type Person, authFile } from "../helpers/people";
import { sql, sqlRows } from "../helpers/sql";

/**
 * The staff home v2 (D186 to D188, D236 to D238) in a browser, for the five seeded staff accounts. The four operational people see, at 360 x 800, the role title, the
 * "Signed in as" line, the strips and the first section with its counts and at least two "Next up" rows (when two exist); the rows equal SQL written here (amount order,
 * Rahul's own requests left out, at most three), each is ONE tap target at least 56px tall; one filled control in each section; no resident name, phone or narration.
 * Meera (committee only) is sent to the report overview, which carries the account footer; Sign out works from there. No horizontal overflow at 360, 768 and 1280.
 * It runs last in the chain because it adds an import and a danger report.
 */
test.skip(({ viewport }) => viewport?.width !== 360, "this spec sets its own viewports");
test.describe.configure({ mode: "serial" });

const ACCOUNTS: { person: Person; name: string; title: string }[] = [
  { person: "priya", name: "Priya Nair", title: "Accountant" },
  { person: "rahul", name: "Rahul Menon", title: "Accountant and approver" },
  { person: "kavita", name: "Kavita Rao", title: "Complaints manager" },
  { person: "sanjay", name: "Sanjay Pawar", title: "Duty manager" },
];

const idOf = (phone: string) => sql<{ id: string }>("SELECT id::text FROM users WHERE phone = $1", [phone]);

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

/** The ids of the "Next up" payments as SQL gives them: for an approver the requests of others first, then the rows that need a person; each group biggest first, newest import first, then the id. */
async function expectedPaymentIds(userId: string, approver: boolean): Promise<string[]> {
  const rows = await sqlRows<{ id: string; state: string; amount: string; uploaded: string; requester: string | null }>(
    `SELECT r.id::text AS id, r.state::text AS state, GREATEST(r.credit_paise, r.debit_paise)::text AS amount, i.uploaded_at::text AS uploaded,
            (SELECT m.decided_by_id::text FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' ORDER BY m.decided_at DESC, m.id DESC LIMIT 1) AS requester
     FROM bank_rows r JOIN statement_imports i ON i.id = r.import_id WHERE r.state IN ('QUEUED', 'AWAITING_APPROVAL')`,
  );
  const order = (a: (typeof rows)[number], b: (typeof rows)[number]) => (BigInt(a.amount) === BigInt(b.amount) ? (a.uploaded === b.uploaded ? a.id.localeCompare(b.id) : b.uploaded.localeCompare(a.uploaded)) : BigInt(a.amount) > BigInt(b.amount) ? -1 : 1);
  const others = approver ? rows.filter((r) => r.state === "AWAITING_APPROVAL" && r.requester !== userId).sort(order) : [];
  const needs = rows.filter((r) => r.state === "QUEUED").sort(order);
  return [...others, ...needs].slice(0, 3).map((r) => r.id);
}

const rowsOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('ul[aria-label="Next up"] > li')].map((li) => {
      const box = li.getBoundingClientRect();
      const links = li.querySelectorAll("a, button");
      return { top: box.top, bottom: box.bottom, height: box.height, targets: links.length, href: links[0]?.getAttribute("href") ?? "", text: (li.textContent ?? "").trim() };
    }),
  );

for (const account of ACCOUNTS) {
  test(`${account.title}: the first screen at 360 x 800, the counts, the Next up rows`, async ({ browser, baseURL }) => {
    const { context, page } = await open(browser, baseURL, account.person, 360, 800);
    const watch = watchPage(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(account.title);
    await expect(page.getByText(`Signed in as ${account.name}`)).toBeVisible();
    const list = await controls(page);
    expect(list.filter((c) => c.filled), "one filled control in the one section").toHaveLength(1);
    expect((await page.locator("main > section").count()) - 1, "one tool section (the account footer is the other)").toBe(1);
    const signOut = list.find((c) => c.text === "Sign out");
    expect(signOut?.width ?? 999).toBeLessThan(300);
    const now = new Date(DEMO_NOW).toISOString();
    const { id: userId } = await idOf(PHONES[account.person]);

    let expectedIds: string[] = [];
    if (account.person === "priya" || account.person === "rahul") {
      const totals = await sql<{ q: number; a: number }>(`SELECT (SELECT count(*) FROM bank_rows WHERE state = 'QUEUED')::int AS q, (SELECT count(*) FROM bank_rows WHERE state = 'AWAITING_APPROVAL')::int AS a`);
      await expect(page.getByText(`${totals.q} need a person · ${totals.a} waiting for approval`)).toBeVisible();
      expect(totals.a).toBeGreaterThanOrEqual(1);
      expectedIds = await expectedPaymentIds(userId, account.person === "rahul");
    }
    if (account.person === "kavita" || account.person === "sanjay") {
      const counts = await sql<{ needs: number; overdue: number }>(
        `SELECT (count(*) FILTER (WHERE c.status <> 'CLOSED' AND ((c.safety_flag AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack')) OR c.assignee_id IS NULL OR (c.needs_review AND c.status = 'NEW') OR (c.assignee_id = $1::uuid AND ((c.response_due_at < $2::timestamptz AND c.first_response_at IS NULL) OR c.status = 'REOPENED')))))::int AS needs,
                (count(*) FILTER (WHERE c.status <> 'CLOSED' AND c.response_due_at < $2::timestamptz AND c.first_response_at IS NULL))::int AS overdue FROM complaints c`,
        [userId, now],
      );
      await expect(page.getByText(`${counts.needs} need action · ${counts.overdue} overdue`)).toBeVisible();
    }
    // The strips: the safety strip for the duty manager only; the approvals strip for an approver only, and it excludes the requests of that person.
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
      const mine = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bank_rows r WHERE r.state = 'AWAITING_APPROVAL' AND NOT EXISTS (SELECT 1 FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' AND m.decided_by_id = $1::uuid)`, [userId]);
      expect(mine.n).toBeGreaterThanOrEqual(1);
      await expect(approvalsStrip).toHaveText(mine.n === 1 ? "1 request is waiting for your approval." : `${mine.n} requests are waiting for your approval.`);
      expect(await approvalsStrip.getAttribute("href")).toMatch(/\/staff\/reconciliation\/[0-9a-f-]{36}\?lane=awaiting-approval/);
    } else {
      await expect(approvalsStrip).toHaveCount(0);
    }

    // The Next up rows: at most three, in the SQL order for payments, each one tap target and at least 56px tall; the first screen holds two when two exist.
    const rows = await rowsOf(page);
    expect(rows.length).toBeLessThanOrEqual(3);
    for (const row of rows) {
      expect(row.targets, `one tap target in the row "${row.text}"`).toBe(1);
      expect(row.height, `row height of "${row.text}"`).toBeGreaterThanOrEqual(56);
    }
    if (account.person === "priya" || account.person === "rahul") {
      expect(rows.length).toBe(expectedIds.length);
      expect(rows.map((r) => /row=([0-9a-f-]{36})/.exec(r.href)?.[1])).toEqual(expectedIds);
      if (account.person === "rahul") {
        const own = await sqlRows<{ id: string }>(`SELECT r.id::text AS id FROM bank_rows r WHERE r.state = 'AWAITING_APPROVAL' AND EXISTS (SELECT 1 FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' AND m.decided_by_id = $1::uuid)`, [userId]);
        for (const row of own) expect(rows.map((r) => r.href).join(" ")).not.toContain(row.id);
      }
    }
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[1].bottom, "the second Next up row is inside the first screen").toBeLessThanOrEqual(800);
    if (account.person === "sanjay") expect(rows[0].text).toContain("Safety");

    // Nothing on the page names a resident, a phone or a narration.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\b5\d{9}\b|UPI\/|Neeraj|Swati|Rohit|Anil|Aamir/);

    if (account.person === "priya") await page.screenshot({ path: "docs/screenshots/staff-home-v2-after-priya-360x800.png", scale: "css" });
    await checkScreen(page, watch, "staff-home", account.person);
    await context.close();
  });
}

test("Meera (committee only) goes straight to the report overview: no launcher card, the account footer at the bottom, no back link", async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL, "meera", 360, 800);
  const watch = watchPage(page);
  await expect(page).toHaveURL(/\/staff\/reports$/);
  await expect(page.getByRole("heading", { level: 1, name: "Committee report" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the report" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to staff home" })).toHaveCount(0);
  const footer = page.getByRole("region", { name: "Your account" });
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByText("Committee · Signed in as Meera Kapoor")).toBeVisible();
  await expect(footer.getByText("View reports")).toBeHidden();
  await footer.getByText("What you can do here").click();
  await expect(footer.getByText("View reports")).toBeVisible();
  const signOut = footer.getByRole("button", { name: "Sign out" });
  const box = await signOut.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  expect(box?.width ?? 999).toBeLessThan(300);
  await page.screenshot({ path: "docs/screenshots/staff-home-v2-after-meera-360x800.png", scale: "css" });
  await checkScreen(page, watch, "committee-landing", "meera");
  await context.close();
});

test("Sign out works from the report overview (Meera, on a session of her own)", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  expect(await loginThroughThePage(page, PHONES.meera)).toBe("/staff/reports");
  await page.getByRole("region", { name: "Your account" }).getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/staff/reports");
  await page.waitForURL(/\/login/);
  await context.close();
});

test("the keyboard goes through the strips, the links, the list and Sign out, in that order (Rahul)", async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL, "rahul", 360, 800);
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim().slice(0, 40)));
    if (order[order.length - 1] === "Sign out") break;
  }
  expect(order[0]).toMatch(/waiting for your approval/);
  expect(order.slice(1, 4).every((text) => /^[\u20b9]/.test(text))).toBe(true);
  await context.close();
});

for (const size of [{ w: 360, h: 800 }, { w: 768, h: 1024 }, { w: 1280, h: 800 }]) {
  test(`no horizontal overflow and axe clean at ${size.w} (the home of four people and the committee landing)`, async ({ browser, baseURL }) => {
    for (const person of ["priya", "rahul", "kavita", "sanjay", "meera"] as const) {
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
