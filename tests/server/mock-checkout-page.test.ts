import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn((options: { need?: string; returnTo?: string }) => Promise.resolve({ id: "11111111-1111-4111-8111-111111111111", role: "RESIDENT", options }));
const untouchable = new Proxy({}, { get: () => { throw new Error("the database was touched"); } });

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
}));
vi.mock("@/server/auth/current-user", () => ({ requireUser: (options: { need?: string; returnTo?: string }) => requireUser(options), withPermissionAction: () => async () => ({ ok: true, data: "NOT_FOUND" }) }));
vi.mock("@/server/auth/default-deps", () => ({ defaultDeps: () => ({ db: untouchable }) }));

afterEach(() => vi.unstubAllEnvs());

const open = async (attemptId: string) => {
  const { default: Page } = await import("@/app/(resident)/pay/mock/[attemptId]/page");
  return Page({ params: Promise.resolve({ attemptId }) });
};

describe("PY7 the demo payment page is a 404 unless DEMO_MODE is exactly 'true'", () => {
  it.each([undefined, "false", "TRUE", "True", "1", "yes", ""])("DEMO_MODE=%j: not found, and the database is not even read", async (value) => {
    if (value === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
    else vi.stubEnv("DEMO_MODE", value);
    await expect(open("22222222-2222-4222-8222-222222222222")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("asks for a signed-in RESIDENT and comes back to this very page after login", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    requireUser.mockClear();
    await open("22222222-2222-4222-8222-222222222222").catch(() => undefined);
    expect(requireUser).toHaveBeenCalledWith({ need: "RESIDENT", returnTo: "/pay/mock/22222222-2222-4222-8222-222222222222" });
  });

  it.each(["not-a-uuid", "../../etc/passwd", "1", ""])("an id like %j is not found, without touching the database", async (id) => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(open(id)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("PY7 the demo payment page view", () => {
  const view = async (status: "INITIATED" | "SUCCEEDED" | "FAILED" | "RELEASED") => {
    const { MockCheckoutView } = await import("@/app/(resident)/pay/mock/[attemptId]/mock-checkout-view");
    const noop = () => {};
    return renderToStaticMarkup(h(MockCheckoutView, { checkout: { attemptId: "33333333-3333-4333-8333-333333333333", flatCode: "T12-0408", amountPaise: 646_800n, status }, onSuccess: noop, onFailure: noop }));
  };
  const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

  it("is labelled as a demo, shows the flat and the amount, and has the two buttons (56px) and one h1", async () => {
    const out = await view("INITIATED");
    expect(words(out)).toContain("Demo payment page (mock gateway)");
    expect(words(out)).toContain("Flat T12-0408");
    expect(words(out)).toContain("₹6,468");
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*min-h-14[^>]*>Pay successfully<\/button>/);
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*min-h-14[^>]*>Payment fails, no money taken<\/button>/);
    expect(out.match(/<input type="hidden" name="attemptId" value="33333333-3333-4333-8333-333333333333"\/>/g)).toHaveLength(2);
  });

  it("prints no secret and no gateway reference", async () => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", "page-test-secret-0123456789abcdefghij");
    const out = await view("INITIATED");
    expect(out).not.toContain("page-test-secret");
    expect(out).not.toContain("MOCK-");
    expect(out).not.toMatch(/secret|signature|x-timestamp/i);
  });

  it.each([["SUCCEEDED", "This payment went through."], ["FAILED", "This payment did not go through. No money was taken."], ["RELEASED", "This payment is already being handled."]] as const)("a %s attempt has no buttons to press, only the result and a way home", async (status, message) => {
    const out = await view(status);
    expect(words(out)).toContain(message);
    expect(out).not.toContain("<form");
    expect(out).toContain('href="/"');
  });
});
