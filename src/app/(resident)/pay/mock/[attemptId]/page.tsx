import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { realNow } from "@/server/clock";
import { loadMockCheckout } from "@/server/payments/mock-checkout";
import { payFails, paySuccessfully } from "./actions";
import { MockCheckoutView } from "./mock-checkout-view";

export const metadata = { title: "Demo payment" };
export const dynamic = "force-dynamic";

/**
 * The demo payment page of the mock gateway (D100). Residents only; a 404 unless DEMO_MODE is exactly "true", and a 404 for
 * an attempt that is not in the person's own flat. Time and money here are the real ones: this page only reports a result.
 */
export default async function MockCheckoutPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const user = await requireUser({ need: "RESIDENT", returnTo: `/pay/mock/${encodeURIComponent(attemptId)}` });
  const checkout = await loadMockCheckout({ db: defaultDeps().db, user, attemptId, now: realNow() });
  if (checkout === null) notFound();
  return <MockCheckoutView checkout={checkout} onSuccess={paySuccessfully} onFailure={payFails} />;
}
