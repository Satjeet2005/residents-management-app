import type { Prng } from "./prng";

/** English only. Hindi and Marathi complaint text has not been written or reviewed by a native speaker. */
const ROOMS = ["kitchen", "bathroom", "bedroom", "balcony", "living room", "wash area", "passage"];
const FLOORS = ["2nd", "5th", "8th", "11th", "14th"];

const TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  PLUMBING: [
    "Water is leaking from the ceiling of my {room}.",
    "The tap in the {room} has been dripping for {days} days.",
    "Low water pressure on the {floor} floor since yesterday.",
    "The drain in the {room} is blocked and water is overflowing.",
    "There is no hot water from the geyser line in the {room}.",
    "A bad smell is coming from the {room} drain.",
    "The flush tank keeps running, please send a plumber.",
    "Seepage on the {room} wall is getting worse every day.",
    "The water pipe near our meter is leaking.",
  ],
  ELECTRICAL: [
    "The tube light in the {floor} floor passage is not working.",
    "Power keeps tripping in my flat for the last {days} days.",
    "The switch board in the {room} is not working.",
    "The MCB in the {room} keeps switching off.",
    "The fan regulator in the {room} stopped working.",
    "The light near the tower gate is off.",
    "The parking area light is flickering at night.",
    "The corridor lights on the {floor} floor stay on all day.",
  ],
  HOUSEKEEPING: [
    "Garbage was not collected from our floor today.",
    "The corridor on the {floor} floor needs cleaning.",
    "The dustbin near the lift lobby is overflowing.",
    "The staircase is dirty after the repair work.",
    "The garden area near our tower has not been cleaned for {days} days.",
    "Dust and cobwebs on the lobby windows.",
    "The lobby floor is wet and needs mopping.",
    "Pigeon droppings on the {floor} floor passage.",
  ],
  LIFT: [
    "The lift is very slow in the morning.",
    "The lift door does not close properly on the {floor} floor.",
    "The button for the {floor} floor in the lift is not working.",
    "There is a strange noise from the lift while going up.",
    "The lift display is not working.",
    "The lift stops at the wrong floor.",
    "The light inside the lift cabin is off.",
    "The lift has not been working since morning, please repair it.",
  ],
  OTHER: [
    "A neighbour is playing loud music late at night.",
    "A car is parked in my slot in the parking area.",
    "The intercom at the main gate is not working.",
    "Stray dogs are gathering near the tower entrance.",
    "I need a copy of the society rules.",
    "The name plate at our flat entrance is broken.",
    "The bench in the garden is broken, please repair it.",
    "Mosquitoes near the garden, please arrange fogging.",
  ],
};

export const SAFETY_KINDS = ["FIRE", "GAS", "LIFT_STUCK", "SHOCK"] as const;
export type SafetyKind = (typeof SAFETY_KINDS)[number];

const SAFETY_TEMPLATES: Readonly<Record<SafetyKind, readonly string[]>> = {
  FIRE: ["Fire in the {room}! Please send help immediately.", "There is smoke and a fire near the electric meter room."],
  GAS: ["Smell of gas in the {room}.", "Strong gas smell near the cylinder store of our tower."],
  LIFT_STUCK: ["Lift stuck between floors with someone inside.", "Lift stuck on the {floor} floor, my father is inside."],
  SHOCK: ["My child got an electric shock from the switch in the {room}.", "I got an electric shock from the water pump panel near our tower."],
};

/** The category a safety kind is filed under. */
export const SAFETY_CATEGORY: Readonly<Record<SafetyKind, string>> = { FIRE: "OTHER", GAS: "OTHER", LIFT_STUCK: "LIFT", SHOCK: "ELECTRICAL" };

function fill(template: string, r: Prng): string {
  return template
    .replace("{room}", r.pick(ROOMS))
    .replace("{floor}", r.pick(FLOORS))
    .replace("{days}", String(r.int(2, 6)));
}

export function complaintBody(r: Prng, categoryCode: string): string {
  return fill(r.pick(TEMPLATES[categoryCode]), r);
}

export function safetyBody(r: Prng, kind: SafetyKind): string {
  return fill(r.pick(SAFETY_TEMPLATES[kind]), r);
}

export const STAFF_COMMENTS: readonly string[] = [
  "A technician will visit today.",
  "Spare part ordered, we will fix it tomorrow.",
  "Please keep the door unlocked between 10 and 12.",
  "The vendor has been informed.",
  "We have checked and the work is in progress.",
];

export const DUPLICATE_COMMENT = "Linked to an earlier complaint about the same problem.";
