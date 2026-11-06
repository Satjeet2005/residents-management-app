"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FORBIDDEN_PATH, loginPath } from "@/server/auth/access";
import { withPermissionAction } from "@/server/auth/current-user";
import { defaultDeps } from "@/server/auth/default-deps";
import { realNow } from "@/server/clock";
import { type MockOutcome, completeMockPayment } from "@/server/payments/mock-checkout";

const complete = withPermissionAction("RESIDENT", ({ user }, attemptId: string, outcome: MockOutcome) =>
  completeMockPayment({ db: defaultDeps().db, user, attemptId, outcome, now: realNow() }),
);

const field = z.object({ attemptId: z.string().max(64) });

/** Both buttons: re-check the person (an action is a public endpoint, whatever page shows it), then act and go Home. */
async function handle(formData: FormData, outcome: MockOutcome): Promise<never> {
  const parsed = field.safeParse({ attemptId: formData.get("attemptId") });
  if (!parsed.success) notFound();
  const result = await complete(parsed.data.attemptId, outcome);
  if (!result.ok) redirect(result.error === "UNAUTHENTICATED" ? loginPath(`/pay/mock/${encodeURIComponent(parsed.data.attemptId)}`) : FORBIDDEN_PATH);
  if (result.data === "NOT_FOUND") notFound();
  redirect("/");
}

/** "Pay successfully": a signed payment.succeeded event for this attempt. */
export async function paySuccessfully(formData: FormData): Promise<void> {
  await handle(formData, "SUCCESS");
}

/** "Payment fails, no money taken": a signed payment.failed event for this attempt. */
export async function payFails(formData: FormData): Promise<void> {
  await handle(formData, "FAILURE");
}
