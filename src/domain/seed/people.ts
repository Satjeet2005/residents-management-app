import { type CalendarDate, addDays } from "../time/calendar";
import { FIRST_NAMES, LAST_NAMES } from "./names";
import type { Prng } from "./prng";
import type { DemoFlat, DemoFlatMember, DemoStaff, DemoUser } from "./types";

type Relation = DemoFlatMember["relation"];

/** Staff are users with role STAFF; they belong to no flat. */
const STAFF: readonly { name: string; permissions: string[] }[] = [
  { name: "Priya Nair", permissions: ["payments:match"] },
  { name: "Rahul Menon", permissions: ["payments:match", "payments:approve"] },
  { name: "Meera Kapoor", permissions: ["reports:view"] },
  { name: "Kavita Rao", permissions: ["complaints:manage"] },
  { name: "Sanjay Pawar", permissions: ["complaints:manage", "complaints:duty_manager"] },
];

/** Residents of the sample flats, fixed so the demo scenarios read the same on every seed. */
const FORCED_RESIDENTS: readonly { flatCode: string; name: string; relation: Relation; startsOn: CalendarDate }[] = [
  { flatCode: "T07-1203", name: "Neeraj Kulkarni", relation: "OWNER", startsOn: "2019-04-01" },
  { flatCode: "T12-0408", name: "Swati Joshi", relation: "TENANT", startsOn: "2025-04-01" },
  { flatCode: "T12-0408", name: "Anil Joshi", relation: "OWNER", startsOn: "2017-06-01" },
  { flatCode: "T21-1601", name: "Aamir Shaikh", relation: "OWNER", startsOn: "2020-01-15" },
  { flatCode: "T15-0902", name: "Rohit Deshmukh", relation: "OWNER", startsOn: "2018-09-01" },
];

const TENANT_SHARE = 0.18;
/** A tenanted flat also lists its owner (a landlord who does not live there). */
const TENANT_FLAT_HAS_OWNER = 0.4;
const OWNER_FLAT_HAS_FAMILY = 0.45;

const RESERVED_NAMES = new Set([...STAFF.map((s) => s.name), ...FORCED_RESIDENTS.map((r) => r.name)]);

export type People = { users: DemoUser[]; members: DemoFlatMember[]; staff: DemoStaff[] };

function drawName(rng: Prng, surname?: string): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = `${rng.pick(FIRST_NAMES)} ${surname ?? rng.pick(LAST_NAMES)}`;
    if (!RESERVED_NAMES.has(name)) return name;
  }
  throw new RangeError("Could not draw a name that avoids the reserved demo names");
}

/**
 * Phone numbers are 10 digits and start with 5, then count up from 5000000001 in
 * creation order. Real Indian mobile numbers start with 6, 7, 8 or 9, so none of
 * these can belong to a real person. The app accepts them only in demo mode.
 */
function phoneNumber(sequence: number): string {
  return `5${String(sequence).padStart(9, "0")}`;
}

export function buildPeople(flats: readonly DemoFlat[], rng: Prng): People {
  const users: DemoUser[] = [];
  const members: DemoFlatMember[] = [];
  let sequence = 0;

  const addUser = (name: string, role: DemoUser["role"]): DemoUser => {
    const phone = phoneNumber(++sequence);
    const user: DemoUser = { key: `user:${phone}`, phone, name, role, active: true };
    users.push(user);
    return user;
  };

  const staff: DemoStaff[] = STAFF.map((s) => ({ userKey: addUser(s.name, "STAFF").key, permissions: [...s.permissions] }));

  const forcedUsers = new Map<string, DemoUser>();
  for (const resident of FORCED_RESIDENTS) forcedUsers.set(resident.name, addUser(resident.name, "RESIDENT"));

  for (const flat of flats) {
    const forced = FORCED_RESIDENTS.filter((r) => r.flatCode === flat.code);
    if (forced.length > 0) {
      for (const r of forced) {
        members.push({ flatKey: flat.key, userKey: (forcedUsers.get(r.name) as DemoUser).key, relation: r.relation, startsOn: r.startsOn, endsOn: null });
      }
      continue;
    }

    const r = rng.fork(`people:${flat.code}`);
    const add = (name: string, relation: Relation, startsOn: CalendarDate) =>
      members.push({ flatKey: flat.key, userKey: addUser(name, "RESIDENT").key, relation, startsOn, endsOn: null });

    if (r.chance(TENANT_SHARE)) {
      add(drawName(r), "TENANT", addDays("2025-01-01", r.int(0, 515)));
      if (r.chance(TENANT_FLAT_HAS_OWNER)) add(drawName(r), "OWNER", addDays("2015-01-01", r.int(0, 3652)));
    } else {
      const ownerName = drawName(r);
      const startsOn = addDays("2015-01-01", r.int(0, 3652));
      add(ownerName, "OWNER", startsOn);
      if (r.chance(OWNER_FLAT_HAS_FAMILY)) add(drawName(r, ownerName.split(" ")[1]), "FAMILY", startsOn);
    }
  }

  return { users, members, staff };
}
