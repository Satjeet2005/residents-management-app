import { FORCED_FLAT_AREAS } from "./flats";
import type { Prng } from "./prng";
import { ACCOUNTS_STAFF_NAME, userKeyByName } from "./settings";
import type { DemoFlat, DemoFlatMember, DemoKnownPayer, DemoUser } from "./types";

/** 30% of the 2,400 flats, as a whole number. */
const KNOWN_PAYER_FLATS = 720;
const LEARNED_SHARE = 0.6;

/** "{first}.{lastInitial}@demo", lower case. "demo" is not a real bank handle, so it cannot be a real UPI id. */
function upiId(name: string): string {
  const [first, last] = name.split(" ");
  return `${first}.${last[0]}@demo`.toLowerCase();
}

/** One UPI id for 720 flats. The sample flats of the payment scenarios have none, so each scenario starts clean. */
export function buildKnownPayers(
  rng: Prng,
  flats: readonly DemoFlat[],
  users: readonly DemoUser[],
  members: readonly DemoFlatMember[],
): DemoKnownPayer[] {
  const nameOf = new Map(users.map((u) => [u.key, u.name]));
  const accountsUserKey = userKeyByName(users, ACCOUNTS_STAFF_NAME);
  const candidates = flats.filter((f) => !(f.code in FORCED_FLAT_AREAS));
  return rng
    .fork("payers:flats")
    .shuffle(candidates)
    .slice(0, KNOWN_PAYER_FLATS)
    .map((flat): DemoKnownPayer => {
      const r = rng.fork(`payers:${flat.code}`);
      const member = r.pick(members.filter((m) => m.flatKey === flat.key));
      const learned = r.chance(LEARNED_SHARE);
      return {
        flatKey: flat.key,
        identifierType: "UPI_ID",
        identifierValue: upiId(nameOf.get(member.userKey) as string),
        source: learned ? "LEARNED" : "MANUAL",
        addedByUserKey: learned ? null : accountsUserKey,
      };
    });
}
