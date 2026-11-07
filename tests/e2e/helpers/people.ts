import path from "node:path";

/**
 * The seeded people the specs use (README, "Demo logins"; phones from src/domain/seed/people.ts). Staff: Priya (payments:match), Rahul (payments:match and
 * payments:approve), Meera (reports:view), Kavita (complaints:manage), Sanjay (complaints:manage and the duty manager). Residents: Neeraj (T07-1203), Swati and
 * Anil (T12-0408, overdue), Aamir (T21-1601, part paid), Rohit (T15-0902). A spec that CHANGES data uses its own flat, so that the specs do not depend on their order.
 */
export const PHONES = {
  priya: "5000000001",
  rahul: "5000000002",
  meera: "5000000003",
  kavita: "5000000004",
  sanjay: "5000000005",
  neeraj: "5000000006",
  swati: "5000000007",
  anil: "5000000008",
  aamir: "5000000009",
  rohit: "5000000010",
} as const;
export type Person = keyof typeof PHONES;

/** The phones whose sessions global setup opens once, through the real login page, so that the specs do not ask for a code again (a code is asked for once per 30 seconds per phone). */
export const SESSION_PEOPLE: readonly Person[] = ["priya", "rahul", "meera", "kavita", "sanjay", "neeraj", "swati", "aamir", "rohit"];

/** Where global setup saved the browser state (cookies) of a person. */
export const authFile = (person: Person): string => path.join("test-results", "auth", `${person}.json`);
