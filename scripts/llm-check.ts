// A HUMAN-run check of the classifier providers' keys (D140):  npm run llm:check
// Sends three fixed, fictional, harmless complaints to every CONFIGURED provider, one request each, and prints one line per provider and sample:
// the provider name, the HTTP status, the latency, the top category and the top urgency with their probabilities.
// It never prints a key, a URL or a response body. It exits 1 when no configured provider answered (or none is configured), and 2 for an invalid setting.
import { pathToFileURL } from "node:url";
import { JevClient } from "../src/server/complaints/providers/client";
import { describeProviders, readJevConfig } from "../src/server/complaints/providers/config";

export const SAMPLES = [
  "Water is leaking under the kitchen sink and the floor is wet.",
  "The light in the corridor outside the flat is not working.",
  "The garbage was not collected from our floor for two days.",
] as const;

type Env = Readonly<Record<string, string | undefined>>;
const PREFIXES = { opencode: "JEV_PRIMARY", jevmodel: "JEV_SECONDARY" } as const;

const top = <L extends string>(entries: { label: L; probability: number }[]): string => {
  const best = entries.reduce((a, b) => (b.probability > a.probability ? b : a));
  return `${best.label} ${best.probability.toFixed(2)}`;
};

/** Runs the check; `print` receives each line. Returns the exit code. */
export async function runCheck(env: Env, print: (line: string) => void): Promise<number> {
  let config;
  try {
    config = readJevConfig(env);
  } catch (error) {
    print(`A setting is not valid: ${error instanceof RangeError ? error.message : "unknown error"}.`);
    return 2;
  }
  for (const { name, status, invalid } of describeProviders(env)) {
    if (status === "configured") continue;
    if (invalid !== undefined) {
      print(`${name}: not checked, ${invalid.variable} is not valid (${invalid.reason}).`);
      continue;
    }
    const prefix = PREFIXES[name];
    const missing = ["URL", "KEY"].filter((part) => (env[`${prefix}_${part}`]?.trim() ?? "") === "").map((part) => `${prefix}_${part}`);
    print(`${name}: not checked, ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`);
  }
  if (config.providers.length === 0) {
    print("No provider is configured, so nothing was checked. Set the JEV_ variables in your own .env (see .env.example).");
    return 1;
  }
  let answered = 0;
  for (const provider of config.providers) {
    const client = new JevClient(provider);
    let providerAnswered = false;
    let askedForModel = false;
    print(`${provider.name}  model: ${provider.model === undefined ? "provider default" : "set"}`);
    for (const [index, text] of SAMPLES.entries()) {
      const outcome = await client.call(text, { timeoutMs: config.timeoutMs });
      const where = `${provider.name}  sample ${index + 1}`;
      if (outcome.ok) {
        providerAnswered = true;
        print(`${where}  HTTP ${outcome.status}  ${outcome.latencyMs} ms  category ${top(outcome.value.categories)}  urgency ${top(outcome.value.urgencies)}`);
      } else {
        print(`${where}  ${outcome.status === undefined ? "no HTTP status" : `HTTP ${outcome.status}`}  ${outcome.latencyMs} ms  failed: ${outcome.failure}`);
        if (provider.model === undefined && (outcome.status === 400 || outcome.status === 422)) askedForModel = true;
      }
    }
    if (askedForModel) print(`${provider.name}: this provider may require a model name: set ${PREFIXES[provider.name]}_MODEL`);
    if (providerAnswered) answered += 1;
  }
  print(answered > 0 ? `${answered} of ${config.providers.length} configured provider(s) answered.` : "Every configured provider failed.");
  return answered > 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: the variables may already be in the environment.
  }
  runCheck(process.env, (line) => console.log(line)).then((code) => process.exit(code), () => process.exit(2));
}
