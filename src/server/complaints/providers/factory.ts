import { businessNow } from "@/server/clock";
import { type Classifier, NullClassifier } from "../classifier";
import { CircuitBreaker } from "./breaker";
import { DailyCap } from "./cap";
import { JevClassifier, type ProviderLog } from "./classifier-jev";
import { JevClient } from "./client";
import { describeProviders, readJevConfig } from "./config";

type Env = Readonly<Record<string, string | undefined>>;
export type FactoryDeps = { now?: () => number; businessClock?: () => number; log?: ProviderLog; warn?: (message: string) => void };

/**
 * The classifier for an environment (D140): a `JevClassifier` over the providers that are configured, or `NullClassifier` when none is. An invalid
 * setting throws a RangeError here, when the classifier is built, never later in a request. Each call builds NEW breakers and caps; the production
 * default below builds them once per server instance. A provider whose model name is invalid is left out and the variable NAME is warned once, never the value (D144).
 */
export function createClassifierFromEnv(env: Env = process.env, deps: FactoryDeps = {}): Classifier {
  const config = readJevConfig(env);
  const warn = deps.warn ?? console.warn;
  for (const { invalid } of describeProviders(env)) {
    if (invalid !== undefined) warn(`classifier provider setting is invalid: variable=${invalid.variable} reason=${invalid.reason}`);
  }
  if (config.providers.length === 0) return NullClassifier;
  const now = deps.now ?? Date.now;
  const businessClock = deps.businessClock ?? (() => businessNow(env));
  const cooldownMs = config.breakerCooldownSeconds * 1000;
  const slots = config.providers.map((provider) => ({
    client: new JevClient(provider),
    breaker: new CircuitBreaker({ failures: config.breakerFailures, cooldownMs, now }),
    cap: new DailyCap(config.dailyCap, businessClock),
  }));
  return new JevClassifier(slots, { timeoutMs: config.timeoutMs, cooldownMs, now, log: deps.log });
}

let production: Classifier | undefined;

/**
 * The classifier the app uses when none is injected: built from the process environment on first use and kept, so the breaker and the daily count live
 * as long as the server instance does. A cold start, or another serverless instance, has its own (D141).
 */
export function productionClassifier(): Classifier {
  production ??= createClassifierFromEnv(process.env);
  return production;
}
