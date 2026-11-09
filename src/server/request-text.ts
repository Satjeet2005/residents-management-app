import { z } from "zod";

/** The plain-English reason a text with a NUL character is refused. A route answers with its own usual validation answer (400 INVALID_REQUEST or 422 VALIDATION). */
export const NUL_MESSAGE = "This text contains a character that is not allowed.";

export const hasNul = (text: string): boolean => text.includes("\u0000");

/**
 * A request text field must not contain U+0000: Postgres refuses it ("invalid byte sequence", Prisma P2039), and a route that let it through
 * answered 500 (audit A-001). Wrap every `z.string()` that takes text from a request: `withoutNul(z.string().max(200))`. A test scans the source
 * and fails for a `z.string()` that neither uses this nor is on its short allowlist.
 */
export function withoutNul<T extends z.ZodString>(schema: T): T {
  return schema.refine((text) => !hasNul(text), { message: NUL_MESSAGE });
}
