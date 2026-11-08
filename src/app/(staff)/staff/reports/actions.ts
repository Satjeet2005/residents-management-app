"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { AGE_BUCKETS } from "@/domain/reports/age";
import { isHttpsFromHeaders } from "@/server/auth/cookie";
import { withPermissionAction } from "@/server/auth/current-user";
import { businessNow } from "@/server/clock";
import { loadAgeingPage } from "@/server/reports/ageing-page";
import { applySectionChoice } from "@/server/reports/view-cookie";

const input = z.object({ bucket: z.enum(AGE_BUCKETS), sort: z.enum(["LARGEST", "OLDEST"]), cursor: z.string().min(1).max(300) });

const more = withPermissionAction("reports:view", async ({ user, deps }, raw: unknown) => {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  return loadAgeingPage({ db: deps.db, user, bucket: parsed.data.bucket, sort: parsed.data.sort, cursor: parsed.data.cursor, now: businessNow() });
});

/** "Show more" of the ageing drill-down: the next page of flats of a bucket, in the order asked for, after `cursor`. The action checks the person itself, because an action is a public endpoint. */
export async function loadMoreAgeing(raw: { bucket: (typeof AGE_BUCKETS)[number]; sort: "LARGEST" | "OLDEST"; cursor: string }) {
  return more(raw);
}

const save = withPermissionAction("reports:view", async (_context, raw: unknown) => {
  const requestHeaders = await headers();
  return applySectionChoice({ raw, headers: requestHeaders, secure: isHttpsFromHeaders(requestHeaders), jar: await cookies() });
});

/** "Save" of the Choose sections sheet: the ids of the sections to hide (none clears the choice). The action checks the person and the request's origin itself. */
export async function saveSections(raw: unknown) {
  return save(raw);
}
