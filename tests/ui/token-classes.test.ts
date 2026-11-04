import { describe, expect, it } from "vitest";
import { classesInSource, classProblem, parseTheme, scanClasses, SCANNED_FILES, splitVariants } from "./class-scan";

const theme = parseTheme();

describe("T6 every Tailwind class in the UI exists in the theme", () => {
  it("scans the component and app files", () => {
    expect(SCANNED_FILES.length).toBeGreaterThanOrEqual(15);
    expect(scanClasses().length).toBeGreaterThan(100);
  });

  it("every class is a structural utility or a token that globals.css defines", () => {
    const unknown = scanClasses()
      .map(({ cls, file }) => ({ cls, file, problem: classProblem(cls, theme) }))
      .filter((entry) => entry.problem !== null)
      .map((entry) => `${entry.file}: ${entry.cls} (${entry.problem})`);
    expect(unknown, `Unknown classes:\n${unknown.join("\n")}`).toEqual([]);
  });

  it("reads the token names from globals.css", () => {
    expect([...theme.colors].sort()).toEqual(["accent", "caution", "control", "hairline", "ink", "ink-2", "paper", "paper-2", "white"]);
    expect([...theme.texts].sort()).toEqual(["body", "caption", "heading", "hero", "title"]);
    expect([...theme.weights].sort()).toEqual(["normal", "semibold"]);
    expect([...theme.radii].sort()).toEqual(["control", "sheet"]);
    expect(theme.utilities.has("tnum")).toBe(true);
  });
});

describe("T6 the checker itself", () => {
  const problem = (cls: string) => classProblem(cls, theme);

  it.each([
    "text-ink", "bg-paper-2", "border-hairline", "text-caption", "font-semibold", "rounded-control", "tnum",
    "min-h-12", "min-h-[56px]", "border-[6px]", "px-4", "gap-1.5", "w-5/6", "bg-ink/50",
    "hover:bg-accent", "focus-visible:border-accent", "sm:grid-cols-4", "after:absolute", "aria-[current=step]:font-semibold", "sr-only", "max-w-lg", "duration-100", "ease-out",
  ])("accepts %s", (cls) => {
    expect(problem(cls)).toBeNull();
  });

  it.each([
    "text-inkk", "bg-red-500", "text-xl", "font-bold", "rounded-lg", "shadow-md", "uppercase", "tracking-wide", "leading-tight",
    "border-gray-300", "hover:text-inkk", "sm:bg-blue-500", "wiggle:flex", "text-[#fff]", "bg-[#fff]",
  ])("reports %s", (cls) => {
    expect(problem(cls)).not.toBeNull();
  });

  it("splits variants only at colons outside brackets", () => {
    expect(splitVariants("hover:after:min-h-[56px]")).toEqual({ variants: ["hover", "after"], utility: "min-h-[56px]" });
    expect(splitVariants("aria-[current=step]:font-semibold")).toEqual({ variants: ["aria-[current=step]"], utility: "font-semibold" });
  });

  it("finds classes in className, cx arguments, and constants that they name", () => {
    const source = `
      const BASE = "flex gap-2";
      const OTHER = "never-used";
      const SIZES = { a: "min-h-12", b: "min-h-14" };
      export const X = () => <p className={cx(BASE, SIZES[s], on && "text-inkk")} />;
      export const Y = () => <p className="p-4 text-ink" />;
      const ROWS = [{ name: "paper", classes: "bg-paper" }];
    `;
    expect(classesInSource(source, "x.tsx").sort()).toEqual(["bg-paper", "flex", "gap-2", "min-h-12", "min-h-14", "p-4", "text-inkk", "text-ink"].sort());
  });

  it("does not read the words of a condition as classes", () => {
    const source = 'export const X = () => <p className={cx(kind === "alert" ? "border-2" : "border", state === "done" && "font-semibold", ok && "p-4")} />;';
    expect(classesInSource(source, "x.tsx").sort()).toEqual(["border", "border-2", "font-semibold", "p-4"]);
  });

  it("reads the literal parts of a template string and the classes of what it inserts", () => {
    const source = "export const X = () => <p className={`flex gap-2 ${s.classes}`} />;";
    expect(classesInSource(source, "x.tsx")).toEqual(["flex", "gap-2"]);
  });

  it("refuses a template string that builds a class name", () => {
    expect(() => classesInSource("export const X = () => <p className={`text-${tone}`} />;", "x.tsx")).toThrow(/write the class names out in full/);
  });
});
