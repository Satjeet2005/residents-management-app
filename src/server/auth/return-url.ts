const MAX_LENGTH = 200;
/** C0 and C1 controls, DEL, and the Unicode line and paragraph separators. Browsers drop tabs and newlines inside a URL. */
const CONTROL = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`);

/** Does a path, once decoded, still start with a single slash and a plain character? */
function isPlainPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") && !CONTROL.test(path);
}

/**
 * Where to send a person after login: a path on this site, or "/".
 *
 * Only a path starting with one "/" followed by a character that is neither "/" nor "\" is accepted: no
 * scheme, no host, no control characters, at most 200 characters. The path is also decoded (twice, to catch
 * double encoding) and must pass the same test, so "/%2f%2fevil.com" and "/%5cevil.com" are refused even
 * though a browser would not read them as hosts today. A bad percent sequence is refused.
 */
export function safeReturnPath(input: unknown): string {
  if (typeof input !== "string" || input.length > MAX_LENGTH || !isPlainPath(input)) return "/";
  let decoded = input;
  try {
    for (let pass = 0; pass < 2; pass++) {
      decoded = decodeURIComponent(decoded);
      if (!isPlainPath(decoded)) return "/";
    }
  } catch {
    return "/";
  }
  return input;
}
