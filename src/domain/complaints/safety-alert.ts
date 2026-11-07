/** The three states of the safety alert on the Home (design 1a, 1b, 1c). */
export type SafetyAlertState = "SENT" | "SEEN" | "NO_ANSWER";

export const DEFAULT_SAFETY_ACK_TIMEOUT_MINUTES = 5;

/**
 * Where an open safety complaint stands for the resident (D126). SEEN once the duty manager has acknowledged it: `first_response_at` is set by the
 * duty manager's acknowledge action (D54). Otherwise NO_ANSWER once `timeoutMinutes` have passed since the complaint was raised, else SENT.
 * Acknowledgement wins over the timeout: a late acknowledgement turns "No answer yet" into "The duty manager has seen your report".
 */
export function safetyAlertState(input: { createdAt: number; firstResponseAt: number | null; now: number; timeoutMinutes: number }): SafetyAlertState {
  if (input.firstResponseAt !== null) return "SEEN";
  return input.now >= input.createdAt + input.timeoutMinutes * 60_000 ? "NO_ANSWER" : "SENT";
}
