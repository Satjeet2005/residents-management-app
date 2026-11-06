import { isDemoMode } from "@/server/clock";

/** What a payment provider gives back when an attempt is created: the reference it will report events under, and where the person pays. */
export type Checkout = { reference: string; checkoutPath: string };

/** The one thing the app asks of a provider. Only the mock exists (D100); a real provider is a second implementation of this. */
export interface PaymentGateway {
  createCheckout(attempt: { id: string }): Checkout;
}

/**
 * The mock gateway of the demo (D100). The reference is `MOCK-<attemptId>` and the checkout page is `/pay/mock/<attemptId>`
 * inside this app. It holds no secret and talks to no network.
 */
export class MockGateway implements PaymentGateway {
  createCheckout(attempt: { id: string }): Checkout {
    return { reference: `MOCK-${attempt.id}`, checkoutPath: `/pay/mock/${attempt.id}` };
  }
}

/**
 * Is a payment provider configured? Only the mock exists, and it is allowed only when DEMO_MODE is exactly "true", so a live
 * deployment without a real provider answers "not configured" (503) instead of letting anyone "pay" for free.
 */
export const paymentProviderConfigured = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => isDemoMode(env);
