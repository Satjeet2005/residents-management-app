import { en } from "./en";

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * A `t` function over a catalog. `{name}` in a message is replaced by `params.name`. A missing parameter throws, so a
 * wrong call is found by a test, not shown to a person as "{name}". No Intl, no plural library: a message that needs a
 * plural has two keys and the code picks one.
 */
export function createT<C extends Readonly<Record<string, string>>>(catalog: C) {
  return (key: keyof C & string, params?: MessageParams): string => {
    const message = catalog[key];
    if (message === undefined) throw new RangeError(`No message for key "${key}"`);
    return message.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
      const value = params?.[name];
      if (value === undefined) throw new RangeError(`Message "${key}" needs the parameter "${name}"`);
      return String(value);
    });
  };
}

export type MessageKey = keyof typeof en;

/** The English catalog. */
export const t = createT(en);
