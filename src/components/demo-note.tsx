import type { DemoNoteState } from "@/lib/demo-note";
import { t } from "@/lib/messages";

/**
 * The calm note about the demo data (D97): it says why the numbers differ from the brief's sample table, or that the date is fixed so
 * they match. The caller shows it only in demo mode (it passes a state, or null for no note); this component only draws it.
 */
export function DemoNote({ note, level = 2 }: { note: DemoNoteState; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="demo-note-title" className="rounded-control border border-control bg-paper-2 p-4">
      <Heading id="demo-note-title" className="text-body font-semibold">
        {t("demo.note.title")}
      </Heading>
      <p className="mt-2 text-body">{note.frozenOn === null ? t("demo.note.live") : t("demo.note.frozen", { date: note.frozenOn })}</p>
    </section>
  );
}

/** The one-line version for the resident Home (at most 25 words), in secondary ink under the recent activity. */
export function DemoNoteLine({ note }: { note: DemoNoteState }) {
  return <p className="text-caption text-ink-2">{note.frozenOn === null ? t("demo.note.short.live") : t("demo.note.short.frozen", { date: note.frozenOn })}</p>;
}
