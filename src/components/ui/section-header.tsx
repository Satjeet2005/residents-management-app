import Link from "next/link";

/** A section title with an optional link on the right, such as "See all". */
export function SectionHeader({ title, action, level = 2 }: { title: string; action?: { label: string; href: string }; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="flex items-center justify-between gap-4">
      <Heading className="text-title font-semibold">{title}</Heading>
      {action !== undefined && (
        <Link href={action.href} className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4">
          {action.label}
        </Link>
      )}
    </div>
  );
}
