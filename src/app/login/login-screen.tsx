import { DemoNote } from "@/components/demo-note";
import type { DemoNoteState } from "@/lib/demo-note";
import { t } from "@/lib/messages";
import { LoginForm } from "./login-form";

/** The whole login page: one heading, the form, and (in demo mode only) the note about the demo data. */
export function LoginScreen({ returnTo, demoNote }: { returnTo: string | null; demoNote: DemoNoteState | null }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-heading font-semibold">{t("login.title")}</h1>
        <p className="text-body text-ink-2">{t("login.intro")}</p>
      </div>
      <LoginForm returnTo={returnTo} />
      {demoNote !== null && <DemoNote note={demoNote} />}
    </main>
  );
}
