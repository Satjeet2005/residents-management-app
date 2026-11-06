import { t } from "@/lib/messages";

/**
 * The calm note about the demo data (D97): it says why the numbers differ from the brief's sample table. Show it only
 * when DEMO_MODE is exactly "true"; the caller decides, this component only draws it.
 */
export function DemoNote({ level = 2 }: { level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="demo-note-title" className="rounded-control border border-control bg-paper-2 p-4">
      <Heading id="demo-note-title" className="text-body font-semibold">
        {t("demo.note.title")}
      </Heading>
      <p className="mt-2 text-body">{t("demo.note.body")}</p>
    </section>
  );
}
