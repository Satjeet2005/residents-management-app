import { SignOutButtons } from "@/components/sign-out-buttons";
import { t } from "@/lib/messages";

/** The message for a staff permission. A permission this app does not know is shown as it is stored. */
export function permissionLabel(permission: string): string {
  switch (permission) {
    case "payments:match":
      return t("permission.paymentsMatch");
    case "payments:approve":
      return t("permission.paymentsApprove");
    case "reports:view":
      return t("permission.reportsView");
    case "complaints:manage":
      return t("permission.complaintsManage");
    case "complaints:duty_manager":
      return t("permission.complaintsDutyManager");
    default:
      return permission;
  }
}

/** The staff landing page. It links nowhere, because no staff feature exists yet: it says who is signed in and what they may do. */
export function StaffView({ name, permissions }: { name: string; permissions: readonly string[] }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("staff.title")}</h1>
      <p className="text-body">{t("staff.signedInAs", { name })}</p>
      <section className="flex flex-col gap-2">
        <h2 className="text-title font-semibold">{t("staff.permissions")}</h2>
        {permissions.length === 0 ? (
          <p className="text-body text-ink-2">{t("staff.permissions.none")}</p>
        ) : (
          <ul className="text-body">
            {[...permissions].sort().map((permission) => (
              <li key={permission} className="border-b border-hairline py-3">
                {permissionLabel(permission)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <SignOutButtons showAll={false} />
    </main>
  );
}
