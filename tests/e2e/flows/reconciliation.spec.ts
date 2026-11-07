import { expect, test } from "@playwright/test";
import { authFile } from "../helpers/people";

/**
 * T15 Part 3, the reconciliation flow with real clicks, in order (the later specs of the chain read what it leaves): Priya imports the sample statement through the page, opens a row, searches
 * another flat, sees Post stay off without a reason, posts a manual match (Aamir's principal-only credit, so a late fee stays due), asks for the second approver on a credit of ₹10,000 or more,
 * and Rahul approves it in a second browser context. The demo threshold is ₹10,000 (D116).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("priya") });

const REASON = "The narration names the flat and the amount equals the bill";

test("import, review, search, post by hand, ask for approval, and approve as a second person", async ({ page, browser, baseURL }) => {
  await page.goto("/staff/reconciliation");
  await page.getByRole("button", { name: "Use the sample statement" }).click();
  await page.getByRole("link", { name: "Open this import" }).click();
  await page.waitForURL(/\/staff\/reconciliation\/[^/?]+/);
  const workspace = page.url().split("?")[0];
  await expect(page.getByText(/All \d+ rows accounted for/)).toBeVisible();

  const importId = workspace.split("/").pop() as string;
  // The list is long and paged, so the page is asked (the route the page itself uses) for the row, then the panel is opened by its link, as a click on "Review" does.
  const openReview = async (narrationPart: string) => {
    let cursor = "";
    for (let pageNo = 0; pageNo < 10; pageNo++) {
      const result = await (await page.request.get(`/api/statements/${importId}/rows?lane=NEEDS_YOU&limit=50${cursor}`)).json();
      const hit = (result.items as { id: string; narrationRaw: string }[]).find((row) => row.narrationRaw.includes(narrationPart));
      if (hit) {
        await page.goto(`${workspace}?lane=needs-you&row=${hit.id}`);
        return;
      }
      if (!result.nextCursor) break;
      cursor = `&cursor=${result.nextCursor}`;
    }
    throw new Error(`no queued row with ${narrationPart}`);
  };

  // Aamir's principal-only credit: a manual match; Post stays off until a reason is written.
  await openReview("710000000003");
  const post = page.getByRole("button", { name: /^Post/ });
  await expect(post).toBeDisabled();
  await page.getByRole("radio").first().check();
  await expect(post).toBeDisabled();
  await page.getByLabel("Choose another flat").fill("T07-1203");
  await expect(page.getByText("1 flat found.")).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByLabel("Choose another flat").fill("T21-1601");
  await expect(page.getByText("1 flat found.")).toBeVisible();
  await page.getByRole("radio", { name: /T21-1601/ }).first().check();
  await page.getByLabel(/^Reason/).fill(REASON);
  await expect(post).toBeEnabled();
  await post.click();
  await expect(page.getByText(/Posted to T21-1601/)).toBeVisible();
  await expect(page.getByText(/late fee still due/)).toBeVisible();

  // The credit of ₹10,000 or more is above the threshold: it waits for a second approver.
  await page.goto(`${workspace}?lane=needs-you`);
  await openReview("730000000001");
  await expect(page.getByText(/needs a second approver/).first()).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByLabel(/^Reason/).fill(REASON);
  await page.getByRole("button", { name: /^Post/ }).click();
  await expect(page.getByText(/now waits in Awaiting approval/)).toBeVisible();

  await page.goto(`${workspace}?lane=awaiting-approval`);
  await expect(page.getByText("Waiting for another approver").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  const second = await browser.newContext({ storageState: authFile("rahul"), baseURL });
  const rahul = await second.newPage();
  await rahul.goto(`${workspace}?lane=awaiting-approval`);
  await rahul.getByRole("button", { name: "Approve" }).filter({ visible: true }).first().click();
  await rahul.getByRole("button", { name: "Confirm approval" }).click();
  await expect(rahul.getByText(/Approved and posted to/)).toBeVisible();
  await second.close();
});
