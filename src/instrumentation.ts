import type { Instrumentation } from "next";

/**
 * Called by Next for every server error that was not turned into a response by our own code (a server component, a server action) (D135).
 * The Node.js runtime only: the database client does not run on the edge, and this app has no edge code. The work is in src/server/on-request-error.ts.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { recordRequestError } = await import("./server/on-request-error");
  await recordRequestError(error, request, context);
};
