import type { ReactNode } from "react";
import { ChevronIcon, CheckIcon, WarningIcon } from "@/components/icons";
import { SignOutButtons } from "@/components/sign-out-buttons";
import { ButtonLink } from "@/components/ui/button-link";
import { cx } from "@/components/ui/cx";
import { can } from "@/domain/auth/permissions";
import { formatDayYear } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { roleTitle } from "@/lib/staff-home";
import { staffToolsFor } from "@/lib/staff-tools";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import type { StaffHomeData } from "@/server/staff/home-data";

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

const NO_NUMBERS: StaffHomeData = { complaints: null, unseenSafety: null, statements: null, approvals: null };

/** One line and one link, in caution ink with an icon and words (never colour alone). The whole strip is the link. */
function Strip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="flex min-h-12 items-center gap-3 rounded-control border-2 border-caution px-4 py-3 text-body font-semibold text-caution">
      <WarningIcon />
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronIcon />
    </a>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-control border border-hairline p-4">
      <h2 className="text-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const Line = ({ children, icon }: { children: ReactNode; icon?: ReactNode }) => (
  <p className="flex items-start gap-2 text-body text-ink-2">
    {icon}
    <span>{children}</span>
  </p>
);

/**
 * The staff home (D186, D187, D188): the role title as the heading, who is signed in, attention strips only when a count is above zero, one card for each tool the
 * person may use (status lines, one filled link and at most one secondary link), what they may do in words, and a small Sign out. The filled link is on the first
 * card only: with more than one tool the others are outlined, because a view has one filled control. A count that could not be read leaves its card without numbers.
 */
export function StaffView({ name, permissions, home = NO_NUMBERS }: { name: string; permissions: readonly string[]; home?: StaffHomeData }) {
  const user = { role: "STAFF" as const, active: true, permissions };
  const duty = can(user, "complaints:duty_manager");
  const approver = can(user, "payments:approve");
  const cards: { key: string; title: string; body: ReactNode; href: string; primary: string; secondary?: { href: string; label: string } }[] = [];

  for (const tool of staffToolsFor(user)) {
    if (tool.key === "complaints") {
      const c = home.complaints;
      cards.push({
        key: tool.key,
        title: t("staff.tool.complaints"),
        body: c === null ? null : c.needsAction === 0 && c.overdue === 0 ? <Line>{t("staff.home.complaints.none")}</Line> : <Line>{t("staff.home.complaints.counts", { needs: c.needsAction, overdue: c.overdue })}</Line>,
        href: tool.href,
        primary: t("staff.home.complaints.open"),
      });
    } else if (tool.key === "reconciliation") {
      const s = home.statements;
      const newest = s?.newest ?? null;
      cards.push({
        key: tool.key,
        title: t("staff.tool.reconciliation"),
        body:
          s === null ? null : newest === null ? (
            <Line>{t("staff.home.statements.none")}</Line>
          ) : (
            <>
              <Line>{t("staff.home.statements.last", { date: formatDayYear(newest.uploadedOn), rows: newest.rowsRead, file: newest.filename })}</Line>
              <Line>{t("staff.home.statements.counts", { needs: s.needsPerson, awaiting: s.awaitingApproval })}</Line>
              {newest.accounted && <Line icon={<CheckIcon />}>{t("staff.home.statements.accounted", { rows: newest.rowsRead })}</Line>}
            </>
          ),
        href: newest === null ? tool.href : workspaceHref({ importId: newest.importId, lane: "NEEDS_YOU" }),
        primary: s !== null && newest === null ? t("staff.home.statements.uploadFirst") : t("staff.home.statements.open"),
        secondary: newest === null ? undefined : { href: tool.href, label: t("staff.home.statements.upload") },
      });
    } else {
      cards.push({ key: tool.key, title: t("staff.tool.reports"), body: <Line>{t("staff.home.reports.about")}</Line>, href: tool.href, primary: t("staff.home.reports.open") });
    }
  }

  const unseen = duty ? (home.unseenSafety ?? 0) : 0;
  const waiting = approver ? (home.approvals?.waiting ?? 0) : 0;
  const approvalsHref = home.approvals?.importId == null ? "/staff/reconciliation" : workspaceHref({ importId: home.approvals.importId, lane: "AWAITING_APPROVAL" });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold">{roleTitle(permissions)}</h1>
        <p className="text-body text-ink-2">{t("staff.signedInAs", { name })}</p>
      </div>
      {(unseen > 0 || waiting > 0) && (
        <div className="flex flex-col gap-2">
          {unseen > 0 && <Strip href="/staff/complaints?view=safety">{unseen === 1 ? t("staff.strip.safetyOne") : t("staff.strip.safetyMany", { n: unseen })}</Strip>}
          {waiting > 0 && <Strip href={approvalsHref}>{waiting === 1 ? t("staff.strip.approvalsOne") : t("staff.strip.approvalsMany", { n: waiting })}</Strip>}
        </div>
      )}
      {cards.length === 0 ? (
        <p className="text-body text-ink-2">{t("staff.home.noTools")}</p>
      ) : (
        <div className={cx("grid grid-cols-1 gap-4", cards.length > 1 ? "md:grid-cols-2" : "max-w-xl")}>
          {cards.map((card, index) => (
            <Card key={card.key} title={card.title}>
              {card.body}
              <div className="flex flex-col items-start gap-2">
                <ButtonLink href={card.href} variant={index === 0 ? "primary" : "outlined"}>
                  {card.primary}
                </ButtonLink>
                {card.secondary !== undefined && (
                  <ButtonLink href={card.secondary.href} variant="link">
                    {card.secondary.label}
                  </ButtonLink>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {permissions.length > 0 && (
        <details>
          <summary className="flex min-h-12 cursor-pointer items-center text-body font-semibold">{t("staff.home.permissions")}</summary>
          <ul className="flex flex-col gap-2 pb-2 text-body">
            {[...permissions].sort().map((permission) => (
              <li key={permission}>{permissionLabel(permission)}</li>
            ))}
          </ul>
        </details>
      )}
      <SignOutButtons showAll={false} compact />
    </main>
  );
}
