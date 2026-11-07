/** The two System One providers, in the order they are tried (D140): OpenCode first, then jevmodel.app. */
export const PROVIDER_NAMES = ["opencode", "jevmodel"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** A provider that is CONFIGURED: its URL and key are present and valid. The model is optional (D144): without one the request omits it and the provider chooses. */
export type ProviderConfig = { name: ProviderName; url: string; model?: string; key: string };

/**
 * Why a provider is not usable (D145). Fixed codes, never a value: URL_INVALID (not a URL, or longer than 2,048 characters), URL_NOT_HTTPS, URL_HAS_CREDENTIALS,
 * MISSING_URL and MISSING_KEY (the provider is partly configured), BAD_MODEL (D144).
 */
export type ProviderReason = "URL_INVALID" | "URL_NOT_HTTPS" | "URL_HAS_CREDENTIALS" | "MISSING_URL" | "MISSING_KEY" | "BAD_MODEL";

/** What the status function says about one provider: its state, and for an invalid one the fixed reason and the variable NAME. Never a value. */
export type ProviderDescription = {
  name: ProviderName;
  status: "configured" | "not_configured" | "invalid";
  model: "set" | "provider_default";
  invalid?: { variable: string; reason: ProviderReason };
};

type SettingState = "default" | "set" | "invalid_using_default";

export type JevConfig = {
  /** The configured providers only, primary first. */
  providers: ProviderConfig[];
  timeoutMs: number;
  dailyCap: number;
  breakerFailures: number;
  breakerCooldownSeconds: number;
  /** The NAMES (never the values) of the variables that were invalid and skipped or replaced by their default, each once, in a fixed order. */
  invalidVariables: string[];
};

type Env = Readonly<Record<string, string | undefined>>;
type Prefix = "JEV_PRIMARY" | "JEV_SECONDARY";
type NumberName = keyof typeof LIMITS;

const LIMITS = {
  JEV_TIMEOUT_MS: { fallback: 3000, min: 500, max: 4000 },
  JEV_DAILY_CAP: { fallback: 300, min: 1, max: 100_000 },
  JEV_BREAKER_FAILURES: { fallback: 3, min: 1, max: 20 },
  JEV_BREAKER_COOLDOWN_SECONDS: { fallback: 120, min: 1, max: 3600 },
} as const;

const MODEL_PATTERN = /^[A-Za-z0-9._\-/:]{1,80}$/;
const MAX_URL_LENGTH = 2048;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** The variable's trimmed value, or undefined when it is unset, blank or not text. */
function read(env: Env, name: string): string | undefined {
  const raw: unknown = env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value === "" ? undefined : value;
}

/** A whole number in its range, or the default with the state saying which. Never throws. */
function whole(env: Env, name: NumberName): { value: number; state: SettingState } {
  const { fallback, min, max } = LIMITS[name];
  const raw = read(env, name);
  if (raw === undefined) return { value: fallback, state: "default" };
  const value = /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value >= min && value <= max ? { value, state: "set" } : { value: fallback, state: "invalid_using_default" };
}

/** An https URL without credentials (http only for 127.0.0.1 and localhost, so the tests can run a fake server), or the fixed reason it is not. */
function checkedUrl(raw: string): { url: string } | { reason: ProviderReason } {
  if (raw.length > MAX_URL_LENGTH) return { reason: "URL_INVALID" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "URL_INVALID" };
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) return { reason: "URL_NOT_HTTPS" };
  if (url.username !== "" || url.password !== "") return { reason: "URL_HAS_CREDENTIALS" };
  return { url: url.toString() };
}

const VARIABLE_OF: Record<ProviderReason, "URL" | "KEY" | "MODEL"> = {
  URL_INVALID: "URL",
  URL_NOT_HTTPS: "URL",
  URL_HAS_CREDENTIALS: "URL",
  MISSING_URL: "URL",
  MISSING_KEY: "KEY",
  BAD_MODEL: "MODEL",
};

type Inspected = { config: ProviderConfig | null; description: ProviderDescription };

/** One provider, judged on its own (D145): nothing set is not configured; a provider with anything wrong is invalid, with the first problem found, and is skipped. */
function inspect(env: Env, name: ProviderName, prefix: Prefix): Inspected {
  const rawUrl = read(env, `${prefix}_URL`);
  const model = read(env, `${prefix}_MODEL`);
  const key = read(env, `${prefix}_KEY`);
  const modelState = model === undefined ? "provider_default" : "set";
  const invalid = (reason: ProviderReason): Inspected => ({ config: null, description: { name, status: "invalid", model: modelState, invalid: { variable: `${prefix}_${VARIABLE_OF[reason]}`, reason } } });
  const badModel = model !== undefined && !MODEL_PATTERN.test(model);
  if (rawUrl === undefined && key === undefined) {
    return badModel ? invalid("BAD_MODEL") : { config: null, description: { name, status: "not_configured", model: modelState } };
  }
  if (rawUrl === undefined) return invalid("MISSING_URL");
  if (key === undefined) return invalid("MISSING_KEY");
  const checked = checkedUrl(rawUrl);
  if ("reason" in checked) return invalid(checked.reason);
  if (badModel) return invalid("BAD_MODEL");
  return { config: { name, url: checked.url, key, ...(model === undefined ? {} : { model }) }, description: { name, status: "configured", model: modelState } };
}

const NUMBER_NAMES = Object.keys(LIMITS) as NumberName[];

/**
 * Reads every `JEV_` setting once (D145). It NEVER throws, whatever the environment holds: a provider with a bad setting is skipped, a bad number falls
 * back to its default, and the result says which.
 */
function inspectAll(env: Env): { providers: Inspected[]; numbers: Record<NumberName, { value: number; state: SettingState }> } {
  const providers = [inspect(env, "opencode", "JEV_PRIMARY"), inspect(env, "jevmodel", "JEV_SECONDARY")];
  const numbers = Object.fromEntries(NUMBER_NAMES.map((name) => [name, whole(env, name)])) as Record<NumberName, { value: number; state: SettingState }>;
  return { providers, numbers };
}

/** The status of both providers, primary first (D144, D145). It never throws and holds no value. */
export function describeProviders(env: Env = process.env): ProviderDescription[] {
  return inspectAll(env).providers.map((p) => p.description);
}

/**
 * Reads the classifier providers' settings (D140, D145). It never throws. A provider is configured when its URL and key are valid and present (the model
 * is optional, D144); any other provider is skipped. A shared number that is invalid is replaced by its default. `invalidVariables` names what was wrong.
 */
export function readJevConfig(env: Env = process.env): JevConfig {
  const { providers, numbers } = inspectAll(env);
  return {
    providers: providers.flatMap((p) => (p.config === null ? [] : [p.config])),
    timeoutMs: numbers.JEV_TIMEOUT_MS.value,
    dailyCap: numbers.JEV_DAILY_CAP.value,
    breakerFailures: numbers.JEV_BREAKER_FAILURES.value,
    breakerCooldownSeconds: numbers.JEV_BREAKER_COOLDOWN_SECONDS.value,
    invalidVariables: [
      ...providers.flatMap((p) => (p.description.invalid === undefined ? [] : [p.description.invalid.variable])),
      ...NUMBER_NAMES.filter((name) => numbers[name].state === "invalid_using_default"),
    ],
  };
}
