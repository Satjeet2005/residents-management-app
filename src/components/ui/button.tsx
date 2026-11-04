import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "outlined" | "link";
export type ButtonSize = "default" | "large";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  /** default: at least 48px tall. large: at least 56px, for the primary Pay button. */
  size?: ButtonSize;
  /** Shows `loadingLabel` instead of the children and ignores clicks. */
  loading?: boolean;
  loadingLabel?: string;
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control px-4 text-body font-semibold transition-colors duration-100 ease-out";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white border-2 border-accent",
  outlined: "bg-paper text-ink border-2 border-control",
  link: "bg-transparent text-accent underline underline-offset-4 border-2 border-transparent",
};

/** A disabled button is a dashed outline with grey text, so it never depends on colour alone. */
const DISABLED = "bg-paper text-ink-2 border-2 border-dashed border-control cursor-not-allowed no-underline";

const SIZES: Record<ButtonSize, string> = { default: "min-h-12", large: "min-h-14" };

export function Button({ variant = "primary", size = "default", loading = false, loadingLabel = "Please wait", type = "button", disabled, children, ...rest }: ButtonProps) {
  const inert = disabled === true || loading;
  return (
    <button
      type={type}
      disabled={inert}
      aria-busy={loading || undefined}
      className={cx(BASE, SIZES[size], inert && !loading ? DISABLED : VARIANTS[variant], loading && "cursor-progress")}
      {...rest}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}
