import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { DEMO_NOW } from "@/domain/seed/types";
import { getHomeData } from "@/server/home/home-data";
import { initiatePayment } from "@/server/payments/initiate";
import { applyGatewayEvent } from "@/server/payments/webhook";
import { type PaymentsFixture, type Resident, createPaymentsFixture } from "./payments-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

/** PY2, PY4, PY8: what the resident sees on the Home after a payment succeeded or failed, read from the database as the app role. */
let fx: PaymentsFixture;
beforeAll(async () => {
  fx = await createPaymentsFixture();
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const outside = (markup: string) => markup.replace(/<dialog[\s\S]*?<\/dialog>/g, "");
const homeOf = async (resident: Resident, now = DEMO_NOW) => {
  const data = await getHomeData({ db: fx.app, user: { id: resident.user.id, name: "Test Resident" }, now });
  if (data.kind !== "OK") throw new Error("no flat");
  return { data, html: renderToStaticMarkup(h(HomeView, { data })) };
};
const start = async (resident: Resident, now = DEMO_NOW) => {
  const result = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now });
  if (result.status !== "CREATED" && result.status !== "EXISTING") throw new Error(result.status);
  return { reference: `MOCK-${result.attemptId}`, amountPaise: result.amountPaise, attemptId: result.attemptId };
};
const event = (type: "payment.succeeded" | "payment.failed", a: { reference: string; amountPaise: bigint }, id: string) => ({ eventId: id, type, reference: a.reference, amountPaise: a.amountPaise });

describe("PY2 after a success the Home shows No dues and the new ledger lines", () => {
  it("says No dues with the last payment, lists the late fee and the payment in Recent activity, has no Pay and no failure strip", async () => {
    const resident = await fx.makeResident();
    const attempt = await start(resident);
    await applyGatewayEvent(fx.app, event("payment.succeeded", attempt, "evt-home-1"), DEMO_NOW);
    const { data, html } = await homeOf(resident);
    expect(data.dues.status).toBe("ALL_PAID");
    const page = words(html);
    expect(page).toContain("No dues");
    expect(page).toContain("Last payment ₹6,468 on 27 Oct");
    expect(page).toContain("Late fee ₹98");
    expect(page).toContain("Payment received ₹6,468");
    expect(page).not.toContain("didn't go through");
    expect(outside(html)).not.toMatch(/>Pay[ <]/);
    expect(html).not.toContain("Paying by bank transfer");
  });
});

describe("PY2 after a failure the Home says so and Pay is still there", () => {
  it("shows the strip above the dues, the dues unchanged, and Pay; a new attempt takes the strip away", async () => {
    const resident = await fx.makeResident();
    const attempt = await start(resident);
    await applyGatewayEvent(fx.app, event("payment.failed", attempt, "evt-home-2"), DEMO_NOW);
    const failed = await homeOf(resident, DEMO_NOW + 60_000);
    expect(failed.data.paymentNotice).toBe("LAST_FAILED");
    expect(words(failed.html)).toContain("That payment didn't go through. No money left your account.");
    expect(words(failed.html)).toContain("₹6,468");
    expect(outside(failed.html)).toContain("Pay ₹6,468</button>");
    expect(failed.html.indexOf("didn&#x27;t go through")).toBeLessThan(failed.html.indexOf("Amount due, as of"));

    await start(resident, DEMO_NOW + 120_000);
    const retried = await homeOf(resident, DEMO_NOW + 180_000);
    expect(retried.data.paymentNotice).toBeNull();
    expect(words(retried.html)).not.toContain("didn't go through");
  });

  it("the strip goes away after 24 hours", async () => {
    const resident = await fx.makeResident();
    const attempt = await start(resident);
    await applyGatewayEvent(fx.app, event("payment.failed", attempt, "evt-home-3"), DEMO_NOW);
    expect((await homeOf(resident, DEMO_NOW + 23 * 3_600_000)).data.paymentNotice).toBe("LAST_FAILED");
    expect((await homeOf(resident, DEMO_NOW + 25 * 3_600_000)).data.paymentNotice).toBeNull();
  });

  it("an exception (a mismatched success) shows nothing to the resident: the attempt is still INITIATED and Pay is still there", async () => {
    const resident = await fx.makeResident();
    const attempt = await start(resident);
    await applyGatewayEvent(fx.app, event("payment.succeeded", { ...attempt, amountPaise: 1n }, "evt-home-4"), DEMO_NOW);
    const { data, html } = await homeOf(resident);
    expect(data.paymentNotice).toBeNull();
    expect(data.dues.status).toBe("OVERDUE");
    expect(outside(html)).toContain("Pay ₹6,468</button>");
  });
});

describe("PY4 no secret reaches any table", () => {
  it("the audit log, the queue, the attempts and the ledger never hold the webhook secret, a signature or a header", async () => {
    const resident = await fx.makeResident();
    const attempt = await start(resident);
    await applyGatewayEvent(fx.app, event("payment.succeeded", { ...attempt, amountPaise: 5n }, "evt-leakcheck-1"), DEMO_NOW);
    await applyGatewayEvent(fx.app, event("payment.succeeded", attempt, "evt-leakcheck-2"), DEMO_NOW);
    const id = attempt.attemptId;
    const rows = async (query: string) => (await fx.owner.$queryRawUnsafe<{ row: string }[]>(query, id)).map((r) => r.row).join("\n");
    const all = (
      await Promise.all([
        rows("SELECT row_to_json(t)::text AS row FROM audit_log t WHERE entity_id = $1"),
        rows("SELECT row_to_json(t)::text AS row FROM accounts_queue_items t WHERE payment_attempt_id = $1::uuid"),
        rows("SELECT row_to_json(t)::text AS row FROM payment_attempts t WHERE id = $1::uuid"),
        rows("SELECT row_to_json(t)::text AS row FROM ledger_entries t WHERE payment_attempt_id = $1::uuid"),
      ])
    ).join("\n");
    expect(all.length).toBeGreaterThan(200);
    expect(all).not.toMatch(/x-signature|x-timestamp|hmac|secret/i);
    expect(all).not.toMatch(/[0-9a-f]{64}/);
  });
});
