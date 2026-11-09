import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { businessNow } from "@/server/clock";
import { getHomeData } from "@/server/home/home-data";
import { type SeededWorld, setupSeededWorld } from "./seeded-world";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

/**
 * D226: with DEMO_MODE=true and DEMO_AS_OF=2026-10-27 the three flats of the client's brief show EXACTLY the brief's numbers on the resident Home
 * and in its dues sheet. The clock is the real businessNow() reading its environment, not a number typed in; the data is the whole seeded demo dataset.
 * The numbers are written here as the brief gives them (rupees, days), independent of the seed.
 */
const FROZEN_ENV = { DEMO_MODE: "true", DEMO_AS_OF: "2026-10-27" };
let world: SeededWorld;

beforeAll(async () => {
  world = await setupSeededWorld();
}, 240_000);
afterAll(async () => {
  await world?.close();
});

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
async function homeText(phone: string, env: Record<string, string | undefined>): Promise<string> {
  const user = await world.ownerPrisma.user.findUniqueOrThrow({ where: { phone }, select: { id: true, name: true, phone: true, role: true } });
  const data = await getHomeData({ db: world.appPrisma, user, now: businessNow(env) });
  return text(renderToStaticMarkup(h(HomeView, { data })));
}

describe("D226 the three sample flats at the demo date (DEMO_AS_OF=2026-10-27)", () => {
  it("T07-1203 (Neeraj Kulkarni): nothing due", async () => {
    const words = await homeText("5000000006", FROZEN_ENV);
    expect(words).toContain("T07-1203");
    expect(words).toContain("No dues");
    expect(words).not.toMatch(/overdue/);
    expect(words).not.toContain("See what makes up this amount");
  });

  it("T12-0408 (Swati Joshi): 47 days overdue, amount due ₹6,468, with the dues sheet working for 27 Oct 2026", async () => {
    const words = await homeText("5000000007", FROZEN_ENV);
    expect(words).toContain("T12-0408");
    expect(words).toContain("₹6,468");
    expect(words).toContain("47 days overdue");
    expect(words).toContain("Amount due, as of 27 Oct");
    expect(words).toContain("Amount as of 27 Oct 2026");
    expect(words).toContain("Late fee so far, 47 days");
    expect(words).toContain("= ₹98.43, rounded to ₹98");
  });

  it("T21-1601 (Aamir Shaikh): 18 days overdue, amount due ₹5,698, with the dues sheet working for 27 Oct 2026", async () => {
    const words = await homeText("5000000009", FROZEN_ENV);
    expect(words).toContain("T21-1601");
    expect(words).toContain("₹5,698");
    expect(words).toContain("18 days overdue");
    expect(words).toContain("Amount as of 27 Oct 2026");
    expect(words).toContain("Late fee so far, 18 days");
  });

  it("without demo mode the same environment value is ignored, so the numbers move with the real date (and differ from the brief's)", async () => {
    const words = await homeText("5000000007", { DEMO_MODE: "false", DEMO_AS_OF: "2026-10-27" });
    expect(words).not.toContain("47 days overdue");
    expect(words).not.toContain("₹6,468");
  });
});
