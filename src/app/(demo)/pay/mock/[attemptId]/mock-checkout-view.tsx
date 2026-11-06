import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { DoubleRule } from "@/components/ui/rules";
import { formatRupees } from "@/domain/money/money";
import { t } from "@/lib/messages";
import type { MockCheckout } from "@/server/payments/mock-checkout";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * The demo payment page, standing in for a real provider (D100). It shows the amount and the flat and two buttons that send
 * a signed result to the app. It prints no secret and no reference. Once the attempt is resolved it has no buttons: the result is final.
 */
export function MockCheckoutView({ checkout, onSuccess, onFailure }: { checkout: MockCheckout; onSuccess: Action; onFailure: Action }) {
  const open = checkout.status === "INITIATED";
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold">{t("mock.title")}</h1>
        <p className="text-body text-ink-2">{t("mock.intro")}</p>
      </header>
      <section aria-label={t("mock.summary")} className="flex flex-col gap-3">
        <p className="tnum text-body">{t("mock.flat", { code: checkout.flatCode })}</p>
        <p className="tnum text-hero font-semibold">{formatRupees(checkout.amountPaise)}</p>
        <DoubleRule />
      </section>
      {open ? (
        <div className="flex flex-col gap-3">
          <form action={onSuccess}>
            <input type="hidden" name="attemptId" value={checkout.attemptId} />
            <Button type="submit" size="large" fullWidth>
              {t("mock.succeed")}
            </Button>
          </form>
          <form action={onFailure}>
            <input type="hidden" name="attemptId" value={checkout.attemptId} />
            <Button type="submit" size="large" fullWidth variant="outlined">
              {t("mock.fail")}
            </Button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-body font-semibold">{checkout.status === "SUCCEEDED" ? t("mock.done.succeeded") : checkout.status === "FAILED" ? t("mock.done.failed") : t("mock.done.other")}</p>
          <ButtonLink href="/" variant="outlined">
            {t("mock.home")}
          </ButtonLink>
        </div>
      )}
    </main>
  );
}
