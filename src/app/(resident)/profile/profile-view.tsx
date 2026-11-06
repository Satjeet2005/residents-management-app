import { DemoNote } from "@/components/demo-note";
import { SignOutButtons } from "@/components/sign-out-buttons";
import { Hairline } from "@/components/ui/rules";
import { SectionHeader } from "@/components/ui/section-header";
import { t } from "@/lib/messages";
import type { ProfileData } from "@/server/profile/profile-data";
import type { FlatRelation } from "@/server/home/types";

function relationText(relation: FlatRelation): string {
  switch (relation) {
    case "OWNER":
      return t("relation.owner");
    case "TENANT":
      return t("relation.tenant");
    case "FAMILY":
      return t("relation.family");
  }
}

const roleText = (role: ProfileData["role"]): string => (role === "STAFF" ? t("role.staff") : t("role.resident"));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-body text-ink-2">{label}</dt>
      <dd className="tnum text-right text-body">{children}</dd>
    </div>
  );
}

/** The Profile page for one person: who they are, which flats, sign out, and (in demo mode) the note about the demo data. */
export function ProfileView({ data, showDemoNote }: { data: ProfileData; showDemoNote: boolean }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-heading font-semibold">{t("profile.title")}</h1>
      <dl>
        <Row label={t("profile.name")}>{data.name}</Row>
        <Hairline />
        <Row label={t("profile.phone")}>{data.phoneMasked}</Row>
        <Hairline />
        <Row label={t("profile.role")}>{roleText(data.role)}</Row>
      </dl>
      <section className="flex flex-col gap-2">
        <SectionHeader title={t("profile.flats")} />
        {data.flats.length === 0 ? (
          <p className="text-body text-ink-2">{t("profile.flats.none")}</p>
        ) : (
          <ul>
            {data.flats.map((flat) => (
              <li key={flat.code} className="flex items-baseline justify-between gap-4 border-b border-hairline py-3">
                <span className="tnum text-body font-semibold">{flat.code}</span>
                <span className="text-body">{relationText(flat.relation)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <SignOutButtons showAll />
      {showDemoNote && <DemoNote />}
    </main>
  );
}
