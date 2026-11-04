import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "@/domain/seed/generate";
import { DEMO_NOW, WINDOW_START } from "@/domain/seed/types";
import { istDateOf } from "@/domain/time/calendar";
import { dataset, flatOf, share } from "./complaint-helpers";

const setting = (key: string) => {
  const found = dataset.settings.find((s) => s.key === key);
  if (found === undefined) throw new Error(`setting ${key} is missing`);
  return found.value;
};

describe("C8 settings and categories", () => {
  it("C8 has exactly the listed keys", () => {
    expect(dataset.settings.map((s) => s.key).sort()).toEqual(
      [
        "accounts_phone",
        "approval_threshold_paise",
        "auto_close_days",
        "demo_as_of",
        "duty_manager_phone",
        "emergency_services_phone",
        "escalation_hours",
        "late_fee_policy",
        "safety_ack_timeout_minutes",
        "sla_minutes",
        "society_bank_account",
      ].sort(),
    );
  });

  it("C8 has the listed values", () => {
    expect(setting("late_fee_policy")).toEqual({ annualRateBps: 1200, capBps: 2100, daysInYear: 365 });
    expect(setting("approval_threshold_paise")).toBe(2500000);
    expect(setting("sla_minutes")).toEqual({ CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 });
    expect(setting("escalation_hours")).toBe(24);
    expect(setting("safety_ack_timeout_minutes")).toBe(5);
    expect(setting("auto_close_days")).toBe(7);
    expect(setting("emergency_services_phone")).toBeNull();
    expect(setting("society_bank_account")).toEqual({ name: "Sample Society Maintenance Account", number: "000000000000", ifsc: "SAMP0000000" });
    expect(setting("demo_as_of")).toBe("2026-10-27");
    expect(dataset.asOf).toBe("2026-10-27");
  });

  it("C8 the duty manager and accounts phones are fictional: 10 digits, start with 5, used by no user", () => {
    const userPhones = new Set(dataset.users.map((u) => u.phone));
    for (const key of ["duty_manager_phone", "accounts_phone"]) {
      const phone = setting(key) as string;
      expect(phone, key).toMatch(/^5\d{9}$/);
      expect(userPhones.has(phone), key).toBe(false);
    }
    expect(setting("duty_manager_phone")).not.toBe(setting("accounts_phone"));
  });

  it("C8 has five categories, all defaulting to Kavita Rao", () => {
    const kavita = dataset.users.find((u) => u.name === "Kavita Rao")!.key;
    expect(dataset.categories.map((c) => c.code)).toEqual(["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"]);
    for (const c of dataset.categories) expect(c.defaultAssigneeUserKey).toBe(kavita);
  });

  it("C8 DEMO_NOW is 2026-10-27 12:00 IST", () => {
    expect(DEMO_NOW).toBe(Date.UTC(2026, 9, 27, 6, 30));
  });
});

describe("C8 visitors, known payers and notifications", () => {
  it("C8 about 150 other flats have 1 to 3 passes; each status fits the time", () => {
    const others = dataset.visitorPasses.filter((p) => p.flatKey !== flatOf("T12-0408").key);
    const perFlat = new Map<string, number>();
    for (const p of others) perFlat.set(p.flatKey, (perFlat.get(p.flatKey) ?? 0) + 1);
    expect(perFlat.size).toBe(150);
    for (const n of perFlat.values()) expect(n).toBeGreaterThanOrEqual(1);
    for (const n of perFlat.values()) expect(n).toBeLessThanOrEqual(3);
    for (const p of others) {
      if (p.expectedAt > DEMO_NOW) expect(["EXPECTED", "CANCELLED"], p.visitorName).toContain(p.status);
      else expect(p.status, p.visitorName).not.toBe("EXPECTED");
    }
  });

  it("C8 passes are today or in the past; future ones are on 2026-10-27", () => {
    for (const p of dataset.visitorPasses) {
      expect(p.expectedAt).toBeGreaterThanOrEqual(WINDOW_START);
      if (p.expectedAt > DEMO_NOW) expect(istDateOf(p.expectedAt)).toBe("2026-10-27");
    }
  });

  it("C8 30% of flats have one UPI id '{first}.{lastInitial}@demo', unique per flat and identifier", () => {
    expect(share(dataset.knownPayers.length, dataset.flats.length)).toBe(30);
    expect(new Set(dataset.knownPayers.map((k) => k.flatKey)).size).toBe(dataset.knownPayers.length);
    const pairs = dataset.knownPayers.map((k) => `${k.flatKey}|${k.identifierValue}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const k of dataset.knownPayers) {
      expect(k.identifierType).toBe("UPI_ID");
      expect(k.identifierValue).toMatch(/^[a-z]+\.[a-z]@demo$/);
      expect(["LEARNED", "MANUAL"]).toContain(k.source);
      expect(k.addedByUserKey === null, k.flatKey).toBe(k.source === "LEARNED");
    }
    expect(new Set(dataset.knownPayers.map((k) => k.source)).size).toBe(2);
  });

  it("C8 each known payer's id comes from a name of that flat's members", () => {
    const names = new Map(dataset.users.map((u) => [u.key, u.name]));
    for (const k of dataset.knownPayers) {
      const ids = dataset.members
        .filter((m) => m.flatKey === k.flatKey)
        .map((m) => {
          const [first, last] = (names.get(m.userKey) as string).split(" ");
          return `${first}.${last[0]}@demo`.toLowerCase();
        });
      expect(ids, k.flatKey).toContain(k.identifierValue);
    }
  });

  it("C8 about 200 other residents have 1 to 3 notifications", () => {
    const sample = new Set(["Swati Joshi", "Neeraj Kulkarni", "Aamir Shaikh", "Rohit Deshmukh"]);
    const names = new Map(dataset.users.map((u) => [u.key, u.name]));
    const perUser = new Map<string, number>();
    for (const n of dataset.notifications) if (!sample.has(names.get(n.userKey) as string)) perUser.set(n.userKey, (perUser.get(n.userKey) ?? 0) + 1);
    expect(perUser.size).toBe(200);
    for (const n of perUser.values()) expect(n).toBeGreaterThanOrEqual(1);
    for (const n of perUser.values()) expect(n).toBeLessThanOrEqual(3);
    expect(dataset.notifications.some((n) => n.readAt !== null)).toBe(true);
    expect(dataset.notifications.some((n) => n.readAt === null)).toBe(true);
    for (const n of dataset.notifications) if (n.readAt !== null) expect(n.readAt).toBeGreaterThanOrEqual(n.createdAt);
  });
});

describe("C8 time range, purity and speed", () => {
  it("C8 every generated timestamp is between 2026-09-01 and DEMO_NOW (future visitors excepted)", () => {
    const times: number[] = [];
    for (const c of dataset.complaints) {
      times.push(c.createdAt);
      for (const t of [c.firstResponseAt, c.pendingConfirmationAt, c.closedAt]) if (t !== null) times.push(t);
    }
    for (const e of dataset.events) times.push(e.createdAt);
    for (const k of dataset.classifications) times.push(k.createdAt);
    for (const l of dataset.links) times.push(l.createdAt);
    for (const a of dataset.affected) times.push(a.createdAt);
    for (const n of dataset.notifications) times.push(n.createdAt, ...(n.readAt === null ? [] : [n.readAt]));
    for (const p of dataset.visitorPasses) if (p.expectedAt <= DEMO_NOW) times.push(p.expectedAt);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(WINDOW_START);
      expect(t).toBeLessThanOrEqual(DEMO_NOW);
    }
  });

  it("C8 the whole dataset is built in under 3 seconds", () => {
    const start = performance.now();
    generateDemoDataset({ seed: 99 });
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it("C8 the seed files use no Math.random, Date.now, Intl or Node built-ins", () => {
    const dir = path.resolve(process.cwd(), "src/domain/seed");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const file of files) expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/Math\.random|Date\.now|\bIntl\b|node:/);
  });
});
