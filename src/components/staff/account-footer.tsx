import { ChevronIcon } from "@/components/icons";
import { SignOutButtons } from "@/components/sign-out-buttons";
import { t } from "@/lib/messages";
import { permissionLabel, roleTitle } from "@/lib/staff-home";

/**
 * The account part of a staff page (D238): who is signed in with the role title (when `identity` is set), what the person may do in words (closed until opened), and a
 * small Sign out. The committee report overview ends with it, because the committee user has no staff home.
 */
export function AccountFooter({ name, permissions, identity = false }: { name: string; permissions: readonly string[]; identity?: boolean }) {
  return (
    <section aria-label={t("staff.account.label")} className="flex flex-col gap-2 border-t border-hairline pt-4">
      {identity && <p className="text-body text-ink-2">{t("staff.account.line", { role: roleTitle(permissions), name })}</p>}
      {permissions.length > 0 && (
        <details>
          <summary className="flex min-h-12 cursor-pointer items-center gap-2 text-body font-semibold">
            <ChevronIcon />
            {t("staff.home.permissions")}
          </summary>
          <ul className="flex flex-col gap-2 pb-2 text-body">
            {[...permissions].sort().map((permission) => (
              <li key={permission}>{permissionLabel(permission)}</li>
            ))}
          </ul>
        </details>
      )}
      <SignOutButtons showAll={false} compact />
    </section>
  );
}
