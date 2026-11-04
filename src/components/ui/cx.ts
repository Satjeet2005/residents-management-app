/** Joins class names, skipping the ones that are false or empty. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
