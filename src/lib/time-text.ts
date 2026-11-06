import { t } from "./messages";

/** "1 second", "45 seconds", "1 minute", "5 minutes": a wait in words, rounded up to whole minutes from one minute on. */
export function waitText(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return s === 1 ? t("time.second", { n: 1 }) : t("time.seconds", { n: s });
  const minutes = Math.ceil(s / 60);
  return minutes === 1 ? t("time.minute", { n: 1 }) : t("time.minutes", { n: minutes });
}
