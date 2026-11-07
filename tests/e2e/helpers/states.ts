import { type APIRequestContext, request } from "@playwright/test";
import { authFile } from "./people";

type Answer = { status: number; json: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(api: APIRequestContext, method: "GET" | "POST", path: string, body?: unknown): Promise<Answer> {
  const response = await api.fetch(path, { method, data: body });
  let json: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch {
    json = null;
  }
  return { status: response.status(), json };
}

/**
 * The data state the resident screens need, created ONCE (global setup) through the app's own route, as the person who would do it: Rohit (T15-0902) has an
 * unacknowledged danger report, so his Home shows the safety alert 1a and an outlined Pay. Everything that needs the sample statement (the late fee only, the rows waiting
 * for approval) is made by the reconciliation flow through the page, later in the chain of projects (see playwright.config.ts). Without a fresh database the state exists.
 */
export async function prepareStates(baseURL: string): Promise<void> {
  const rohit = await request.newContext({ baseURL, storageState: authFile("rohit") });
  try {
    const mine = await call(rohit, "GET", "/api/complaints");
    if (((mine.json?.complaints as unknown[] | undefined) ?? []).some((c) => (c as { safetyFlag?: boolean }).safetyFlag === true)) return;
    const danger = await call(rohit, "POST", "/api/complaints", { body: "Bench near the tower 2 gate needs paint", declaredDanger: true });
    if (danger.status !== 201 && danger.status !== 200) throw new Error(`the danger report was not raised (${danger.status})`);
  } finally {
    await rohit.dispose();
  }
}
