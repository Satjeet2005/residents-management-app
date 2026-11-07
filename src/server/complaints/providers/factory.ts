import { businessNow } from "@/server/clock";
import { type Classifier, NullClassifier } from "../classifier";
import { CircuitBreaker } from "./breaker";
import { DailyCap } from "./cap";
import { JevClassifier, type ProviderLog, type ProviderWarning } from "./classifier-jev";
import { JevClient } from "./client";
import { readJevConfig } from "./config";
import { warnProviderAuthFailed, warnProviderBreakerOpened } from "@/server/warnings";

type Env = Readonly<Record<string, string | undefined>>;
export type FactoryDeps = { now?: () => number; businessClock?: () => number; log?: ProviderLog; warn?: (message: string) => void; warnEvent?: (warning: ProviderWarning) => void };

/**
 * The classifier for an environment (D140): a `JevClassifier` over the providers that are usable, or `NullClassifier` when none is. It NEVER throws
 * (D145): a provider with a bad setting is skipped, a bad shared number falls back to its default, and each bad variable is warned ONCE with its NAME
 * only, never a value. Each call builds NEW breakers and caps; the production default below is built once per server instance, so a problem is
 * reported once per instance.
 */
export function createClassifierFromEnv(env: Env = process.env, deps: FactoryDeps = {}): Classifier {
  const config = readJevConfig(env);
  const warn = deps.warn ?? console.warn;
  for (const variable of config.invalidVariables) warn(`classifier setting invalid: ${variable}`);
  if (config.providers.length === 0) return NullClassifier;
  const now = deps.now ?? Date.now;
  const businessClock = deps.businessClock ?? (() => businessNow(env));
  const cooldownMs = config.breakerCooldownSeconds * 1000;
  const slots = config.providers.map((provider) => ({
    client: new JevClient(provider),
    breaker: new CircuitBreaker({ failures: config.breakerFailures, cooldownMs, now }),
    cap: new DailyCap(config.dailyCap, businessClock),
  }));
  return new JevClassifier(slots, { timeoutMs: config.timeoutMs, cooldownMs, now, log: deps.log, warn: deps.warnEvent });
}

/** The production sink for provider warnings: stored in error_events, once per cooldown (D135). Tests build a classifier without it. */
function storeProviderWarning(warning: ProviderWarning): void {
  if (warning.kind === "BREAKER_OPENED") warnProviderBreakerOpened(warning.provider, warning.cooldownMs);
  else warnProviderAuthFailed(warning.provider, warning.status, warning.cooldownMs);
}

let production: Classifier | undefined;

/**
 * The classifier the app uses when none is injected: built from the process environment on first use and kept, so the breaker and the daily count live
 * as long as the server instance does. A cold start, or another serverless instance, has its own (D141).
 */
export function productionClassifier(): Classifier {
  production ??= createClassifierFromEnv(process.env, { warnEvent: storeProviderWarning });
  return production;
}
