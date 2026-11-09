import { z } from "zod";
import { withoutNul } from "@/server/request-text";

/** Largest request body read, in characters. A login body is a few dozen. */
export const MAX_BODY_CHARS = 4096;

/** Unknown fields are removed (zod's default), never passed on. */
export const requestOtpBody = z.object({ phone: withoutNul(z.string().max(32)) });

export const verifyOtpBody = z.object({
  phone: withoutNul(z.string().max(32)),
  code: z.string().regex(/^[0-9]{6}$/),
  returnTo: withoutNul(z.string().max(2000)).optional(),
});
