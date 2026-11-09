import type { ReactNode } from "react";
import { ChevronIcon, CheckIcon, WarningIcon } from "@/components/icons";
import { AccountFooter } from "@/components/staff/account-footer";
import { ButtonLink } from "@/components/ui/button-link";
import { can } from "@/domain/auth/permissions";
import { formatDayYear } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { NEXT_UP_MAX, type SeeAll, roleTitle } from "@/lib/staff-home";
import { staffToolsFor } from "@/lib/staff-tools";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import type { StaffHomeData } from "@/server/staff/home-data";
import { ComplaintRow, PaymentRow } from "./next-up-rows";

export { permissionLabel } from "@/lib/staff-home";

const NO_NUMBERS: StaffHomeData = { complaints: null, unseenSafety: null, statements: null, approvals: null, paymentRows: null, complaintRows: null };

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-hairline pt-4">
      <h2 className="text-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const Counts = ({ children, icon }: { children: ReactNode; icon?: ReactNode }) => (
  <p className="flex items-start gap-2 text-caption text-ink-2">
    {icon}
    <span>{children}</span>
  </p>
);

const SeeAllLink = ({ href, label }: SeeAll) => (
  <a href={href} className="inline-flex min-h-12 items-center gap-2 text-body font-semibold text-accent underline underline-offset-4">
    {label}
  </a>
);

const CALM = () => <p className="text-body text-ink-2">{t("staff.home.nothing")}</p>;

function ComplaintsSection({ home, href, now }: { home: StaffHomeData; href: string; now: number }) {
  const c = home.complaints;
  const rows = home.complaintRows;
  const seeAll: SeeAll | null = c !== null && c.needsAction > NEXT_UP_MAX ? { href: "/staff/complaints?view=needs_action", label: t("staff.home.seeAll.complaints", { n: c.needsAction }) } : null;
  return (
    <Section title={t("staff.tool.complaints")}>
      {c !== null && <Counts>{t("staff.home.complaints.counts", { needs: c.needsAction, overdue: c.overdue })}</Counts>}
      {rows !== null && rows.length === 0 && <CALM />}
      {rows !== null && rows.length > 0 && (
        <ul aria-label={t("staff.home.nextUp")} className="flex flex-col gap-2">
          {rows.map((row) => (
            <ComplaintRow key={row.id} row={row} now={now} />
          ))}
        </ul>
      )}
      {seeAll !== null && <SeeAllLink {...seeAll} />}
      <div className="flex flex-col items-start gap-2">
        <ButtonLink href={href} variant="primary">
          {t("staff.home.complaints.open")}
        </ButtonLink>
      </div>
    </Section>
  );
}

function ReconciliationSection({ home, href }: { home: StaffHomeData; href: string }) {
  const s = home.statements;
  const rows = home.paymentRows;
  const newest = s?.newest ?? null;
  const first = rows?.[0];
  const seeAllCount = first === undefined || s === null ? 0 : first.lane === "AWAITING_APPROVAL" ? (home.approvals?.waiting ?? 0) : s.needsPerson;
  const seeAllImport = first?.lane === "AWAITING_APPROVAL" ? home.approvals?.importId : newest?.importId;
  const seeAll: SeeAll | null =
    first !== undefined && seeAllCount > NEXT_UP_MAX && seeAllImport != null
      ? { href: workspaceHref({ importId: seeAllImport, lane: first.lane }), label: first.lane === "AWAITING_APPROVAL" ? t("staff.home.seeAll.approvals", { n: seeAllCount }) : t("staff.home.seeAll.needsYou", { n: seeAllCount }) }
      : null;
  return (
    <Section title={t("staff.tool.reconciliation")}>
      {s !== null && newest === null && <Counts>{t("staff.home.statements.none")}</Counts>}
      {s !== null && newest !== null && (
        <div className="flex flex-col gap-1">
          <Counts>{t("staff.home.statements.counts", { needs: s.needsPerson, awaiting: s.awaitingApproval })}</Counts>
          {newest.accounted && <Counts icon={<CheckIcon />}>{t("staff.home.statements.accounted", { rows: newest.rowsRead })}</Counts>}
          <Counts>{t("staff.home.statements.last", { date: formatDayYear(newest.uploadedOn) })}</Counts>
        </div>
      )}
      {newest !== null && rows !== null && rows.length === 0 && <CALM />}
      {rows !== null && rows.length > 0 && (
        <ul aria-label={t("staff.home.nextUp")} className="flex flex-col gap-2">
          {rows.map((row) => (
            <PaymentRow key={row.id} row={row} />
          ))}
        </ul>
      )}
      {seeAll !== null && <SeeAllLink {...seeAll} />}
      <div className="flex flex-col items-start gap-2">
        <ButtonLink href={newest === null ? href : workspaceHref({ importId: newest.importId, lane: "NEEDS_YOU" })} variant="primary">
          {s !== null && newest === null ? t("staff.home.statements.uploadFirst") : t("staff.home.statements.open")}
        </ButtonLink>
        {newest !== null && (
          <ButtonLink href={href} variant="link">
            {t("staff.home.statements.upload")}
          </ButtonLink>
        )}
      </div>
    </Section>
  );
}

/**
 * The staff home (D186 to D188, D237): the role title as the heading, who is signed in, attention strips only when a count is above zero, then one section for each tool
 * the person may use in a fixed order: a counts line, the "Next up" rows (at most three, one tap each), a "See all" link only when there are more, and the filled link of
 * the tool. Then what the person may do in words and a small Sign out. A read that failed leaves its section without numbers or rows; the page never crashes.
 */
export function StaffView({ name, permissions, home = NO_NUMBERS, now = 0 }: { name: string; permissions: readonly string[]; home?: StaffHomeData; now?: number }) {
  const user = { role: "STAFF" as const, active: true, permissions };
  const duty = can(user, "complaints:duty_manager");
  const approver = can(user, "payments:approve");
  const tools = staffToolsFor(user);
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
      {tools.length === 0 && <p className="text-body text-ink-2">{t("staff.home.noTools")}</p>}
      {tools.map((tool) =>
        tool.key === "complaints" ? (
          <ComplaintsSection key={tool.key} home={home} href={tool.href} now={now} />
        ) : tool.key === "reconciliation" ? (
          <ReconciliationSection key={tool.key} home={home} href={tool.href} />
        ) : (
          <Section key={tool.key} title={t("staff.tool.reports")}>
            <div className="flex flex-col items-start gap-2">
              <ButtonLink href={tool.href} variant="primary">
                {t("staff.home.reports.open")}
              </ButtonLink>
            </div>
          </Section>
        ),
      )}
      <AccountFooter name={name} permissions={permissions} />
    </main>
  );
}
