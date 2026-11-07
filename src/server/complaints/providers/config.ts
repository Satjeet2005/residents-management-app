/** The two System One providers, in the order they are tried (D140): OpenCode first, then jevmodel.app. */
export const PROVIDER_NAMES = ["opencode", "jevmodel"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** A provider that is CONFIGURED: its URL and key are present and valid. The model is optional (D144): without one the request omits it and the provider chooses. */
export type ProviderConfig = { name: ProviderName; url: string; model?: string; key: string };

/** What the status function says about one provider. `invalid` is a model name that failed the check; the variable is named, the value never is. */
export type ProviderDescription = {
  name: ProviderName;
  status: "configured" | "not_configured" | "invalid";
  model: "set" | "provider_default";
  invalid?: { variable: string; reason: "BAD_MODEL" };
};

export type JevConfig = {
  /** The configured providers only, primary first. */
  providers: ProviderConfig[];
  timeoutMs: number;
  dailyCap: number;
  breakerFailures: number;
  breakerCooldownSeconds: number;
};

type Env = Readonly<Record<string, string | undefined>>;

const LIMITS = {
  JEV_TIMEOUT_MS: { fallback: 3000, min: 500, max: 4000 },
  JEV_DAILY_CAP: { fallback: 300, min: 1, max: 100_000 },
  JEV_BREAKER_FAILURES: { fallback: 3, min: 1, max: 20 },
  JEV_BREAKER_COOLDOWN_SECONDS: { fallback: 120, min: 1, max: 3600 },
} as const;

const MODEL_PATTERN = /^[A-Za-z0-9._\-/:]{1,80}$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** The variable's trimmed value, or undefined when it is unset or blank. */
function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function whole(env: Env, name: keyof typeof LIMITS): number {
  const { fallback, min, max } = LIMITS[name];
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const value = /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be a whole number from ${min} to ${max}`);
  return value;
}

/** An https URL without credentials (http only for 127.0.0.1 and localhost, so the tests can run a fake server). The message never repeats the value. */
function checkedUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RangeError(`${name} must be an https URL`);
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) throw new RangeError(`${name} must be an https URL (http is allowed only for 127.0.0.1 and localhost)`);
  if (url.username !== "" || url.password !== "") throw new RangeError(`${name} must not contain credentials`);
  return url.toString();
}

type Inspected = { config: ProviderConfig | null; description: ProviderDescription };

function inspect(env: Env, name: ProviderName, prefix: "JEV_PRIMARY" | "JEV_SECONDARY"): Inspected {
  const rawUrl = read(env, `${prefix}_URL`);
  const model = read(env, `${prefix}_MODEL`);
  const key = read(env, `${prefix}_KEY`);
  const url = rawUrl === undefined ? undefined : checkedUrl(`${prefix}_URL`, rawUrl);
  const modelState = model === undefined ? "provider_default" : "set";
  if (model !== undefined && !MODEL_PATTERN.test(model)) {
    return { config: null, description: { name, status: "invalid", model: modelState, invalid: { variable: `${prefix}_MODEL`, reason: "BAD_MODEL" } } };
  }
  if (url === undefined || key === undefined) return { config: null, description: { name, status: "not_configured", model: modelState } };
  return { config: { name, url, key, ...(model === undefined ? {} : { model }) }, description: { name, status: "configured", model: modelState } };
}

function inspectAll(env: Env): Inspected[] {
  return [inspect(env, "opencode", "JEV_PRIMARY"), inspect(env, "jevmodel", "JEV_SECONDARY")];
}

/** The status of both providers, primary first (D144). Throws like `readJevConfig` for an invalid URL. */
export function describeProviders(env: Env = process.env): ProviderDescription[] {
  return inspectAll(env).map((p) => p.description);
}

/**
 * Reads the classifier providers' settings (D140). A provider is configured when its URL and key are present; the model is optional (D144).
 * A partly configured provider is skipped, and so is one whose model name is invalid (BAD_MODEL, see `describeProviders`). Any other value that is present but invalid throws a RangeError at once (the factory calls this at start-up), never
 * later in a request, and the error never repeats a URL or a key.
 */
export function readJevConfig(env: Env = process.env): JevConfig {
  return {
    providers: inspectAll(env).flatMap((p) => (p.config === null ? [] : [p.config])),
    timeoutMs: whole(env, "JEV_TIMEOUT_MS"),
    dailyCap: whole(env, "JEV_DAILY_CAP"),
    breakerFailures: whole(env, "JEV_BREAKER_FAILURES"),
    breakerCooldownSeconds: whole(env, "JEV_BREAKER_COOLDOWN_SECONDS"),
  };
}
