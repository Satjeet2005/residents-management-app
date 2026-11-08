/** The five sections of the committee report, in page order. The headline cards are not sections and cannot be hidden. */
export const SECTION_IDS = ["money", "owed", "quality", "complaints", "bank"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
