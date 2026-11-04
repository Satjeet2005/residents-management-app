/** The double rule of a ledger: two 2px ink lines with a 3px gap (7px in all). Decorative. */
export function DoubleRule() {
  return <div aria-hidden="true" className="h-[7px] border-y-2 border-ink" />;
}

/** A 1px ruled line between rows. */
export function Hairline() {
  return <hr className="m-0 border-0 border-t border-hairline" />;
}
