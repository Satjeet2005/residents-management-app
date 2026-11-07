/** The three states of the safety alert on the Home (design 1a, 1b, 1c). */
export type SafetyAlertState = "SENT" | "SEEN" | "NO_ANSWER";

export const DEFAULT_SAFETY_ACK_TIMEOUT_MINUTES = 5;

/**
 * Where an open safety complaint stands for the resident (D126, D54 as amended by D149). SEEN only once the duty manager has acknowledged it:
 * `acknowledgedAt` is the time of the ACKNOWLEDGED fact that the duty manager's acknowledge action alone records. A first reply, assignment or status
 * change by any other staff member is not an acknowledgement and is never passed here. Otherwise NO_ANSWER once `timeoutMinutes` have passed since
 * the complaint was raised, else SENT. Acknowledgement wins over the timeout: a late acknowledgement turns "No answer yet" into "The duty manager has seen your report".
 */
export function safetyAlertState(input: { createdAt: number; acknowledgedAt: number | null; now: number; timeoutMinutes: number }): SafetyAlertState {
  if (input.acknowledgedAt !== null) return "SEEN";
  return input.now >= input.createdAt + input.timeoutMinutes * 60_000 ? "NO_ANSWER" : "SENT";
}
