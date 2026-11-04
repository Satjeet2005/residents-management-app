import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { GLOBALS_CSS } from "./css-tokens";

/** Folders whose .tsx files are scanned for class names. */
const SCAN_DIRS = ["src/components", "src/app"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

export const SCANNED_FILES: string[] = SCAN_DIRS.flatMap((dir) => tsxFiles(path.resolve(process.cwd(), dir))).sort();

const COMPARISONS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);

/**
 * The distinct class names that a source file uses. A class comes from:
 * a string inside a `className` attribute, a string inside a `cx(...)` call,
 * a property called `className` or `classes`, and the strings of a module-level
 * ALL_CAPS constant that a className or cx expression names (BASE, VARIANTS, ...).
 */
export function classesInSource(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const named = new Set<string>();

  const addStrings = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) found.push(...node.text.split(/\s+/).filter(Boolean));
    if (ts.isTemplateExpression(node)) {
      const pieces = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      pieces.forEach((text, i) => {
        const glued = (i > 0 && !/^\s/.test(text) && text !== "") || (i < pieces.length - 1 && !/\s$/.test(text) && text !== "");
        if (glued) throw new Error(`${fileName}: a template string builds a class name (${node.getText()}); write the class names out in full so they can be checked`);
        found.push(...text.split(/\s+/).filter(Boolean));
      });
      node.templateSpans.forEach((span) => addStrings(span.expression));
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      addStrings(node.initializer);
      return;
    }
    // A condition is not a class: in `on ? "a" : "b"` and `on && "a"` only the results count, and `kind === "alert"` has none.
    if (ts.isConditionalExpression(node)) {
      addStrings(node.whenTrue);
      addStrings(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (COMPARISONS.has(op)) return;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return addStrings(node.right);
    }
    ts.forEachChild(node, addStrings);
  };
  const collectNames = (node: ts.Node) => {
    if (ts.isIdentifier(node) && /^[A-Z][A-Z0-9_]*$/.test(node.text)) named.add(node.text);
    ts.forEachChild(node, collectNames);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText() === "className" && node.initializer) {
      addStrings(node.initializer);
      collectNames(node.initializer);
    } else if (ts.isCallExpression(node) && node.expression.getText() === "cx") {
      node.arguments.forEach((arg) => {
        addStrings(arg);
        collectNames(arg);
      });
    } else if (ts.isPropertyAssignment(node) && ["className", "classes"].includes(node.name.getText())) {
      addStrings(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && named.has(decl.name.text) && decl.initializer) addStrings(decl.initializer);
    }
  }
  return [...new Set(found)];
}

export function scanClasses(): { cls: string; file: string }[] {
  return SCANNED_FILES.flatMap((file) => classesInSource(readFileSync(file, "utf8"), file).map((cls) => ({ cls, file: path.relative(process.cwd(), file) })));
}

export type Theme = { colors: Set<string>; texts: Set<string>; weights: Set<string>; radii: Set<string>; fonts: Set<string>; utilities: Set<string> };

const names = (css: string, prefix: string): Set<string> =>
  new Set([...css.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+?):`, "g"))].map((m) => m[1]).filter((n) => !n.includes("--")));

/** The names the theme in globals.css defines: colours, text sizes, weights, radii, fonts and custom utilities. */
export function parseTheme(css: string = GLOBALS_CSS): Theme {
  const withoutWeights = css.replaceAll("--font-weight-", "--weight-");
  return {
    colors: names(css, "color"),
    texts: new Set([...css.matchAll(/--text-([a-z0-9-]+?):/g)].map((m) => m[1]).filter((n) => !n.includes("--"))),
    weights: names(withoutWeights, "weight"),
    radii: names(css, "radius"),
    fonts: names(withoutWeights, "font"),
    utilities: new Set([...css.matchAll(/@utility ([a-z0-9-]+)/g)].map((m) => m[1])),
  };
}

/**
 * Structural utilities that need no theme token: layout, alignment, position,
 * display, overflow and the like. Anything not here and not a theme token is
 * reported. Utilities with no allowlist entry on purpose: uppercase, shadows,
 * letter-spacing and line-height classes, because the design bans them.
 */
export const STRUCTURAL: ReadonlySet<string> = new Set([
  "block", "inline", "inline-block", "flex", "inline-flex", "grid", "contents", "hidden",
  "flex-col", "flex-row", "flex-wrap", "flex-nowrap", "flex-1", "grow", "shrink-0",
  "items-start", "items-center", "items-end", "items-baseline", "items-stretch",
  "justify-start", "justify-center", "justify-end", "justify-between",
  "self-start", "self-center", "self-end",
  "relative", "absolute", "fixed", "sticky", "static",
  "overflow-hidden", "overflow-auto", "overflow-x-auto", "overflow-y-auto",
  "sr-only", "not-sr-only", "tabular-nums", "underline", "no-underline",
  "text-left", "text-center", "text-right", "text-wrap", "break-words",
  "truncate", "whitespace-nowrap", "list-none", "border-solid", "border-dashed", "border-dotted", "border-none",
  "cursor-pointer", "cursor-not-allowed", "cursor-progress", "cursor-default",
  "pointer-events-none", "select-none", "transition-colors", "content-['']", "align-middle",
  "rounded-full", "rounded-none", "bg-transparent", "text-inherit",
]);

/** Prefixes whose value is a number of 4px steps, a fraction, a keyword or an arbitrary length: spacing, size and position. */
const SIZE_PREFIXES = [
  "p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml",
  "gap", "gap-x", "gap-y", "space-x", "space-y", "w", "h", "min-w", "min-h", "max-w", "max-h", "size",
  "top", "right", "bottom", "left", "inset", "inset-x", "inset-y", "z", "basis", "order", "col-span", "grid-cols",
];
const SIZE_VALUE = /^(\d+(\.5)?|\d+\/\d+|px|auto|full|screen|min|max|fit|\[[^\]]+\])$/;

/**
 * Default Tailwind values that globals.css leaves switched on: container widths
 * (--container-* is not reset), the ease curves, durations and underline offsets.
 */
const KEPT_DEFAULTS: readonly RegExp[] = [/^max-w-(none|xs|sm|md|lg|xl|[2-7]xl)$/, /^duration-\d+$/, /^ease-(in|out|in-out|linear)$/, /^underline-offset-\d+$/];

const BORDER_PREFIXES = ["border", "border-x", "border-y", "border-t", "border-r", "border-b", "border-l"];
const BORDER_WIDTH = /^(\d+|\[\d+px\])$/;
const COLOUR_PREFIXES = [...BORDER_PREFIXES, "text", "bg", "outline", "ring", "fill", "stroke", "decoration", "divide", "accent", "caret"];
const COLOUR_KEYWORDS = new Set(["transparent", "current", "inherit"]);
const RADIUS_PREFIXES = ["rounded", "rounded-t", "rounded-b", "rounded-l", "rounded-r"];

/** Variants a class may carry (hover:, sm:, after:, ...). Arbitrary `aria-[..]` and `data-[..]` variants are accepted. */
export const VARIANTS: ReadonlySet<string> = new Set([
  "hover", "focus", "focus-visible", "focus-within", "active", "disabled", "open", "first", "last",
  "before", "after", "backdrop", "sm", "md", "lg", "xl", "motion-reduce", "motion-safe", "group-hover",
]);

/** Splits "hover:after:min-h-[56px]" at the colons that are outside square brackets. */
export function splitVariants(cls: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === "[") depth++;
    else if (cls[i] === "]") depth--;
    else if (cls[i] === ":" && depth === 0) {
      parts.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  const utility = cls.slice(start);
  return { variants: parts, utility };
}

function utilityProblem(utility: string, theme: Theme): string | null {
  const bare = utility.replace(/^!|!$/g, "").replace(/^-(?=[a-z])/, "");
  const [base] = bare.split(/\/(?=\d+$)/);
  const hasOpacity = base !== bare;
  if (!hasOpacity && (STRUCTURAL.has(bare) || theme.utilities.has(bare) || KEPT_DEFAULTS.some((pattern) => pattern.test(bare)))) return null;

  const dash = (prefix: string) => (base.startsWith(`${prefix}-`) ? base.slice(prefix.length + 1) : null);
  const longestFirst = (prefixes: string[]) => [...prefixes].sort((a, b) => b.length - a.length);

  for (const prefix of longestFirst(COLOUR_PREFIXES)) {
    const value = dash(prefix);
    if (value === null) continue;
    if (theme.colors.has(value) || COLOUR_KEYWORDS.has(value)) return null;
    if (prefix === "text" && theme.texts.has(value) && !hasOpacity) return null;
    if (BORDER_PREFIXES.includes(prefix) && BORDER_WIDTH.test(value) && !hasOpacity) return null;
    if (BORDER_PREFIXES.includes(prefix) || prefix === "text") continue;
    return `"${value}" is not a colour in the theme`;
  }
  if (!hasOpacity && BORDER_PREFIXES.includes(base)) return null;
  for (const prefix of longestFirst(SIZE_PREFIXES)) {
    const value = bare.startsWith(`${prefix}-`) ? bare.slice(prefix.length + 1) : null;
    if (value !== null && SIZE_VALUE.test(value)) return null;
  }
  for (const prefix of RADIUS_PREFIXES) {
    if (base === prefix) return null;
    const value = dash(prefix);
    if (value !== null && theme.radii.has(value)) return null;
  }
  const weight = dash("font");
  if (weight !== null && (theme.weights.has(weight) || theme.fonts.has(weight))) return null;
  return "not a structural utility and not a token in the theme";
}

/** Why a class is unknown, or null when it is a known utility with known variants. */
export function classProblem(cls: string, theme: Theme): string | null {
  const { variants, utility } = splitVariants(cls);
  for (const variant of variants) {
    if (!VARIANTS.has(variant) && !/^(aria|data)-\[[^\]]+\]$/.test(variant)) return `unknown variant "${variant}:"`;
  }
  return utilityProblem(utility, theme);
}
