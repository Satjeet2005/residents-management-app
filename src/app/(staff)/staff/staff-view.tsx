import Link from "next/link";
import { SignOutButtons } from "@/components/sign-out-buttons";
import { t } from "@/lib/messages";
import { type StaffTool, staffToolsFor } from "@/lib/staff-tools";

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

const toolLabel = (tool: StaffTool): string => {
  switch (tool.key) {
    case "reconciliation":
      return t("staff.tool.reconciliation");
    case "complaints":
      return t("staff.tool.complaints");
    case "reports":
      return t("staff.tool.reports");
  }
};
const toolHint = (tool: StaffTool): string => {
  switch (tool.key) {
    case "reconciliation":
      return t("staff.tool.reconciliation.hint");
    case "complaints":
      return t("staff.tool.complaints.hint");
    case "reports":
      return t("staff.tool.reports.hint");
  }
};

/** The open safety complaints under the Complaints tool, in words; nothing when there are none. */
const safetyNote = (openSafety: number): string | null => (openSafety === 0 ? null : openSafety === 1 ? t("staff.tool.complaints.safetyOne") : t("staff.tool.complaints.safetyMany", { n: openSafety }));

/** The staff landing page: who is signed in, the tools they may open (Complaints says how many safety complaints are open), what they may do in words, and sign out. */
export function StaffView({ name, permissions, openSafety = 0 }: { name: string; permissions: readonly string[]; openSafety?: number }) {
  const tools = staffToolsFor({ role: "STAFF", active: true, permissions });
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("staff.title")}</h1>
      <p className="text-body">{t("staff.signedInAs", { name })}</p>
      <section aria-labelledby="staff-tools" className="flex flex-col gap-2">
        <h2 id="staff-tools" className="text-title font-semibold">
          {t("staff.tools")}
        </h2>
        {tools.length === 0 ? (
          <p className="text-body text-ink-2">{t("staff.tools.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tools.map((tool) => (
              <li key={tool.key} className="flex flex-col border-b border-hairline pb-3">
                <Link href={tool.href} className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4">
                  {toolLabel(tool)}
                </Link>
                <span className="text-caption text-ink-2">{toolHint(tool)}</span>
                {tool.key === "complaints" && safetyNote(openSafety) !== null && <span className="text-body font-semibold text-caution">{safetyNote(openSafety)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="staff-permissions" className="flex flex-col gap-2">
        <h2 id="staff-permissions" className="text-title font-semibold">
          {t("staff.permissions")}
        </h2>
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
