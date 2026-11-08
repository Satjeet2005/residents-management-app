import { z } from "zod";
import { SECTION_IDS, VIEW_COOKIE, VIEW_COOKIE_MAX_AGE_SECONDS, serializeHiddenSections } from "@/lib/reports/sections";
import { isCrossSiteRequest } from "@/server/auth/csrf";

/** The hidden sections a person chose: at most five ids, all from the five sections, none twice. */
export const hiddenSectionsInput = z
  .array(z.enum(SECTION_IDS))
  .max(SECTION_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length);

/** The part of the cookie store the action needs (Next's `cookies()` has it). */
export type CookieJar = {
  set: (name: string, value: string, options: { path: string; httpOnly: boolean; sameSite: "lax"; secure: boolean; maxAge: number }) => unknown;
  delete: (options: { name: string; path: string }) => unknown;
};

/**
 * Remembers which sections a person hid. A request from another site is REFUSED; anything that is not a list of section ids is INVALID and changes nothing; an
 * empty list ("Show everything") deletes the cookie. Otherwise the cookie `committee_view` is set for the staff pages only (Path=/staff), HttpOnly, SameSite=Lax,
 * Secure when the request came over https, for one year. The permission to see the report is checked by the action around this, before it runs.
 */
export function applySectionChoice(input: { raw: unknown; headers: Pick<Headers, "get">; secure: boolean; jar: CookieJar }): "SAVED" | "REFUSED" | "INVALID" {
  if (isCrossSiteRequest(input.headers, `http://${input.headers.get("host") ?? "localhost"}/staff/reports`)) return "REFUSED";
  const parsed = hiddenSectionsInput.safeParse(input.raw);
  if (!parsed.success) return "INVALID";
  if (parsed.data.length === 0) {
    input.jar.delete({ name: VIEW_COOKIE, path: "/staff" });
    return "SAVED";
  }
  input.jar.set(VIEW_COOKIE, serializeHiddenSections(parsed.data), { path: "/staff", httpOnly: true, sameSite: "lax", secure: input.secure, maxAge: VIEW_COOKIE_MAX_AGE_SECONDS });
  return "SAVED";
}
