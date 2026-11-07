/** Why a complaint action did not happen. The route maps each to a status and a fixed code (src/server/complaints/handlers.ts). */
export type ComplaintError = "FORBIDDEN" | "NOT_FOUND" | "STALE" | "INVALID_TRANSITION" | "NO_FLAT" | "VALIDATION" | "ASSIGNEE_INVALID";

export type ComplaintFailure = { status: "ERROR"; error: ComplaintError };
export const failure = (error: ComplaintError): ComplaintFailure => ({ status: "ERROR", error });
