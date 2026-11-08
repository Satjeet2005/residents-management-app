"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/** The card of a row that opens its review: a link, so Enter works, and Space does the same, as it does on a button (D191). */
export function RowLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onKeyDown={(event) => {
        if (event.key !== " ") return;
        event.preventDefault();
        router.push(href.toString());
      }}
      {...rest}
    />
  );
}
