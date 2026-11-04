import { dayStartInstant } from "../time/calendar";
import { drawMoment } from "./moments";
import type { Prng } from "./prng";
import { COMPLAINT_ASSIGNEE_NAME } from "./settings";
import { DEMO_NOW, type DemoNotification, type DemoUser } from "./types";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const RESIDENTS_WITH_NOTIFICATIONS = 200;
const READ_SHARE = 0.5;
const SAMPLE_RESIDENTS = ["Swati Joshi", "Neeraj Kulkarni", "Aamir Shaikh", "Rohit Deshmukh"];

const OTHER_KINDS: readonly { value: { kind: string; body: string }; weight: number }[] = [
  { value: { kind: "PAYMENT_REMINDER", body: "Your maintenance bill is due soon. Please pay by the 10th to avoid a late fee." }, weight: 25 },
  { value: { kind: "PAYMENT_RECEIVED", body: "We received your maintenance payment. Thank you." }, weight: 25 },
  { value: { kind: "COMPLAINT_UPDATE", body: "There is an update on your complaint." }, weight: 25 },
  { value: { kind: "NOTICE", body: "A new notice has been posted by the society office." }, weight: 25 },
];

/** Swati Joshi has exactly two unread notifications; about 200 other residents have one to three. */
export function buildNotifications(rng: Prng, users: readonly DemoUser[]): DemoNotification[] {
  const swati = users.find((u) => u.name === "Swati Joshi");
  if (swati === undefined) throw new RangeError("Swati Joshi is missing");
  const notifications: DemoNotification[] = [
    {
      userKey: swati.key,
      kind: "COMPLAINT_ASSIGNED",
      body: `Your complaint "Water leak under the kitchen sink" was assigned to ${COMPLAINT_ASSIGNEE_NAME}.`,
      createdAt: dayStartInstant("2026-10-26") + 17 * HOUR + 30 * MINUTE,
      readAt: null,
    },
    {
      userKey: swati.key,
      kind: "PAYMENT_REMINDER",
      body: "Your maintenance bill for September is overdue. Please pay to stop the late fee growing.",
      createdAt: dayStartInstant("2026-10-27") + 9 * HOUR,
      readAt: null,
    },
  ];

  const residents = users.filter((u) => u.role === "RESIDENT" && !SAMPLE_RESIDENTS.includes(u.name));
  for (const user of rng.fork("notifications:users").shuffle(residents).slice(0, RESIDENTS_WITH_NOTIFICATIONS)) {
    const r = rng.fork(`notifications:${user.key}`);
    const count = r.int(1, 3);
    for (let i = 0; i < count; i++) {
      const createdAt = drawMoment(r);
      const readAt = r.chance(READ_SHARE) ? createdAt + r.int(5, 2000) * MINUTE : null;
      notifications.push({ userKey: user.key, ...r.weighted(OTHER_KINDS), createdAt, readAt: readAt !== null && readAt <= DEMO_NOW ? readAt : null });
    }
  }
  return notifications;
}
