import type { CalendarDate } from "@/domain/time/calendar";
import { periodQuery } from "./period";

/**
 * The four pages behind the committee report's overview (hub and spoke). `headline` names the sentence of `report.headlines` that the "Look closer" row of the page
 * shows; `monthly` says whether the month selector applies to it (the others show all months or the last 30 days).
 */
export const SECTIONS = [
  { slug: "collections", headline: "money", monthly: true },
  { slug: "dues", headline: "owed", monthly: false },
  { slug: "complaints", headline: "complaints", monthly: true },
  { slug: "bank", headline: "bank", monthly: false },
] as const;
export type SectionSlug = (typeof SECTIONS)[number]["slug"];

/** The page named by the address, or null for anything that is not exactly one of the four slugs. */
export const sectionFromSlug = (value: string): SectionSlug | null => SECTIONS.find((s) => s.slug === value)?.slug ?? null;

/** The address of a section page for a period. */
export const sectionHref = (slug: SectionSlug, period: CalendarDate): string => `/staff/reports/${slug}?period=${periodQuery(period)}`;

/** The address of the overview for a period. */
export const overviewHref = (period: CalendarDate): string => `/staff/reports?period=${periodQuery(period)}`;
