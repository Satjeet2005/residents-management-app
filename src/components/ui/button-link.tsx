import type { AnchorHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonLinkVariant = "primary" | "outlined" | "link";

const BASE = "inline-flex items-center justify-center gap-2 rounded-control px-4 text-body font-semibold transition-colors duration-100 ease-out";
const VARIANTS: Record<ButtonLinkVariant, string> = {
  primary: "bg-accent text-white border-2 border-accent",
  outlined: "bg-paper text-ink border-2 border-control",
  link: "bg-transparent text-accent underline underline-offset-4 border-2 border-transparent",
};

/** A link that looks like a Button (for a tel: or a page address). 48px tall by default, 56px when large. */
export function ButtonLink({ variant = "primary", large = false, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { variant?: ButtonLinkVariant; large?: boolean }) {
  return <a className={cx(BASE, large ? "min-h-14" : "min-h-12", VARIANTS[variant])} {...rest} />;
}
