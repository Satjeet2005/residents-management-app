"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { type ImportOutcome, checkFileText, failureText, formatFileSize, importedText, interpretImportResponse, invalidCsvLines } from "@/lib/reconciliation/import";
import { workspaceHref } from "@/lib/reconciliation/lanes";
import { t } from "@/lib/messages";

type Phase = { status: "IDLE" } | { status: "WORKING"; what: "IMPORT" | "SAMPLE" } | { status: "SHOWN"; text: string; kind: "alert" | "status"; lines: string[]; importId: string | null };

/** What was shown for an outcome: a sentence or two, and the id of the import when it succeeded. */
export function presentOutcome(outcome: ImportOutcome | { kind: "NETWORK" } | { kind: "UNREADABLE" } | { kind: "TOO_BIG_HERE"; message: string }, filename: string): Extract<Phase, { status: "SHOWN" }> {
  switch (outcome.kind) {
    case "IMPORTED":
      return { status: "SHOWN", kind: "status", text: importedText(filename, outcome.summary), lines: [], importId: outcome.importId };
    case "INVALID_CSV":
      return { status: "SHOWN", kind: "alert", text: t("recon.upload.invalid.title"), lines: invalidCsvLines(outcome.errors), importId: null };
    case "UNREADABLE":
      return { status: "SHOWN", kind: "alert", text: t("recon.upload.unreadable"), lines: [], importId: null };
    case "TOO_BIG_HERE":
      return { status: "SHOWN", kind: "alert", text: outcome.message, lines: [], importId: null };
    default:
      return { status: "SHOWN", kind: "alert", text: failureText(outcome), lines: [], importId: null };
  }
}

/**
 * The upload panel: choose a .csv, see its name and size, Import. The file is read as text here in the browser and refused over
 * 2,000,000 characters before anything is sent. In demo mode a second button imports the committed sample statement. One request
 * at a time: both buttons are inert while one is running. Results are announced in a status region.
 */
export function UploadPanel({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ status: "IDLE" });
  const working = phase.status === "WORKING";

  async function send(what: "IMPORT" | "SAMPLE") {
    setPhase({ status: "WORKING", what });
    let filename = "sample-statement.csv";
    let init: RequestInit = { method: "POST" };
    let path = "/api/statements/sample";
    if (what === "IMPORT") {
      if (file === null) return setPhase({ status: "IDLE" });
      let text: string;
      try {
        text = await file.text();
      } catch {
        return setPhase(presentOutcome({ kind: "UNREADABLE" }, file.name));
      }
      const check = checkFileText(text);
      if (!check.ok) return setPhase(presentOutcome({ kind: "TOO_BIG_HERE", message: check.message }, file.name));
      filename = file.name.slice(0, 200);
      path = "/api/statements";
      init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename, csv: text }) };
    }
    try {
      const response = await fetch(path, init);
      const body: unknown = await response.json().catch(() => null);
      const outcome = interpretImportResponse(response.status, body);
      setPhase(presentOutcome(outcome, filename));
      if (outcome.kind === "IMPORTED") router.refresh();
    } catch {
      setPhase(presentOutcome({ kind: "NETWORK" }, filename));
    }
  }

  return (
    <section aria-labelledby="recon-upload" className="flex flex-col gap-4 rounded-control border border-hairline p-4">
      <h2 id="recon-upload" className="text-title font-semibold">
        {t("recon.upload.title")}
      </h2>
      <p className="text-body text-ink-2">{t("recon.upload.hint")}</p>
      <div className="flex flex-col gap-2">
        <label htmlFor="recon-file" className="text-body font-semibold">
          {t("recon.upload.file")}
        </label>
        <input
          id="recon-file"
          type="file"
          accept=".csv,text/csv"
          disabled={working}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPhase({ status: "IDLE" });
          }}
          className="min-h-12 w-full rounded-control border-2 border-control bg-paper p-2 text-body"
        />
        <p className="tnum text-body">{file === null ? t("recon.upload.none") : t("recon.upload.chosen", { name: file.name, size: formatFileSize(file.size) })}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled={file === null || working} loading={phase.status === "WORKING" && phase.what === "IMPORT"} loadingLabel={t("recon.upload.importing")} onClick={() => send("IMPORT")}>
          {t("recon.upload.import")}
        </Button>
        {demo && (
          <Button variant="outlined" disabled={working} loading={phase.status === "WORKING" && phase.what === "SAMPLE"} loadingLabel={t("recon.upload.sampling")} onClick={() => send("SAMPLE")}>
            {t("recon.upload.sample")}
          </Button>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {phase.status === "SHOWN" && (
          <Notice kind={phase.kind}>
            <p className="text-body">{phase.text}</p>
            {phase.lines.length > 0 && (
              <ul className="mt-2 text-body">
                {phase.lines.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {phase.status === "SHOWN" && phase.importId !== null && (
          <Link href={workspaceHref({ importId: phase.importId, lane: "NEEDS_YOU" })} className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4">
            {t("recon.upload.open")}
          </Link>
        )}
      </div>
    </section>
  );
}
