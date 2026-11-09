import { describe, expect, it } from "vitest";
import { deidentify, type Replacement } from "@/domain/complaints/deidentify";
import { createPrng } from "@/domain/seed/prng";

type Case = [label: string, input: string, names: string[], expected: string, replacements: Replacement[]];
const R = (type: Replacement["type"], count = 1): Replacement => ({ type, count });

const CASES: Case[] = [
  // phone numbers
  ["ten digits", "call 9876543210 now", [], "call [PHONE] now", [R("PHONE")]],
  ["5 and 5", "call 98765 43210", [], "call [PHONE]", [R("PHONE")]],
  ["+91 with spaces", "+91 98765 43210", [], "[PHONE]", [R("PHONE")]],
  ["+91 with hyphens and trailing words", "+91-98765-43210 please", [], "[PHONE] please", [R("PHONE")]],
  ["91 prefix", "91 9876543210", [], "[PHONE]", [R("PHONE")]],
  ["0 prefix", "09876543210", [], "[PHONE]", [R("PHONE")]],
  ["a hyphen", "98765-43210", [], "[PHONE]", [R("PHONE")]],
  ["a dot", "98765.43210", [], "[PHONE]", [R("PHONE")]],
  ["two spaces", "98765  43210", [], "[PHONE]", [R("PHONE")]],
  ["Devanagari digits", "९८७६५४३२१०", [], "[PHONE]", [R("PHONE")]],
  ["Devanagari digits with a hyphen", "०९८७६-५४३२१", [], "[PHONE]", [R("PHONE")]],
  ["+91 in Devanagari digits", "+९१ ९८७६५ ४३२१०", [], "[PHONE]", [R("PHONE")]],
  ["ASCII and Devanagari digits mixed", "98765४३२१०", [], "[PHONE]", [R("PHONE")]],
  ["a comma after the number", "my number is 9876543210, thanks", [], "my number is [PHONE], thanks", [R("PHONE")]],
  ["two numbers", "9876543210 and 9123456780", [], "[PHONE] and [PHONE]", [R("PHONE", 2)]],
  ["a zero-width character inside", "98765​43210", [], "[PHONE]", [R("PHONE")]],
  ["a twelve digit reference is treated as a number too", "ref 402200118877", [], "ref [PHONE]", [R("PHONE")]],
  ["a flat number, a date, a time and an amount are not phones", "flat 408 on 27-10-2026 at 10:30 paid ₹6,468 in 5 days", [], "flat 408 on 27-10-2026 at 10:30 paid ₹6,468 in 5 days", []],
  // e-mail, UPI address, web address
  ["an e-mail", "mail me at aamir.shaikh@example.com today", [], "mail me at [EMAIL] today", [R("EMAIL")]],
  ["an e-mail with a plus and upper case", "A.B+tag@Example.CO.IN", [], "[EMAIL]", [R("EMAIL")]],
  ["two e-mails", "a@b.com, c@d.org", [], "[EMAIL], [EMAIL]", [R("EMAIL", 2)]],
  ["a UPI address", "paid from aamir.s@oksbi", [], "paid from [EMAIL]", [R("EMAIL")]],
  ["an e-mail at the end of a sentence", "write to s@x.com.", [], "write to [EMAIL].", [R("EMAIL")]],
  ["a web address", "see https://example.com/a?b=1 for the photo", [], "see [URL] for the photo", [R("URL")]],
  ["a web address without a scheme", "photo at www.drive.example.com/x", [], "photo at [URL]", [R("URL")]],
  ["a web address in capitals", "HTTP://X.COM/PHOTO", [], "[URL]", [R("URL")]],
  ["a web address in brackets", "(https://a.example/x)", [], "([URL])", [R("URL")]],
  // flat codes
  ["a flat code", "water leak in T12-0408", [], "water leak in [FLAT]", [R("FLAT")]],
  ["a flat code written loosely", "flat t12 408 has a leak", [], "flat [FLAT] has a leak", [R("FLAT")]],
  ["two flat codes", "T01/0205 and T21-1601", [], "[FLAT] and [FLAT]", [R("FLAT", 2)]],
  ["the same code twice", "T12-0408 T12-0408", [], "[FLAT] [FLAT]", [R("FLAT", 2)]],
  ["the same flat in two spellings", "T12-0408 and t12 408", [], "[FLAT] and [FLAT]", [R("FLAT", 2)]],
  ["a tower that does not exist is not a flat", "T99-0101 is not a flat", [], "T99-0101 is not a flat", []],
  ["a word that starts with T is not a flat", "Tuesday 408", [], "Tuesday 408", []],
  // known names
  ["a known full name", "Aamir Shaikh called", ["Aamir Shaikh"], "[NAME] called", [R("NAME")]],
  ["a known name in lower case", "aamir shaikh called", ["Aamir Shaikh"], "[NAME] called", [R("NAME")]],
  ["one word of a known name", "Shaikh ji called", ["Aamir Shaikh"], "[NAME] ji called", [R("NAME")]],
  ["two known people", "Swati and Aamir", ["Aamir Shaikh", "Swati Joshi"], "[NAME] and [NAME]", [R("NAME", 2)]],
  ["a short name is replaced only as a whole", "Jo Li went, Jo stayed", ["Jo Li"], "[NAME] went, Jo stayed", [R("NAME")]],
  ["a name inside a longer word is kept", "Amitabh and Amit", ["Amit"], "Amitabh and [NAME]", [R("NAME")]],
  ["a Devanagari name given exactly", "आमिर शेख ने कहा", ["आमिर शेख"], "[NAME] ने कहा", [R("NAME")]],
  ["an inflected Devanagari name is NOT replaced (a documented limit)", "आमिरला सांगा", ["आमिर"], "आमिरला सांगा", []],
  ["a name that is a placeholder word is never replaced alone", "Phone problem", ["Name Phone"], "Phone problem", []],
  // honorifics
  ["Mr and a name", "Mr Sharma complained", [], "[NAME] complained", [R("NAME")]],
  ["Mrs with a full stop and two names", "Mrs. Joshi Patil called", [], "[NAME] called", [R("NAME")]],
  ["Dr", "Dr Mehta came", [], "[NAME] came", [R("NAME")]],
  ["Shri", "Shri Rao said", [], "[NAME] said", [R("NAME")]],
  ["Smt", "Smt Kulkarni said", [], "[NAME] said", [R("NAME")]],
  ["Sri", "Sri Kumar said", [], "[NAME] said", [R("NAME")]],
  ["Ms", "Ms Nair said", [], "[NAME] said", [R("NAME")]],
  ["Mister", "Mister Singh said", [], "[NAME] said", [R("NAME")]],
  ["MR in capitals", "MR SHARMA said", [], "[NAME] said", [R("NAME")]],
  ["an honorific with a lower-case word is not a name", "Mr is here", [], "Mr is here", []],
  ["a lower-case name after an honorific is kept (documented limit)", "mr sharma said", [], "mr sharma said", []],
  // together, and the edges
  ["everything at once", "Mr Sharma (T12-0408) phone 98765 43210 mail s@x.com see https://x.com", [], "[NAME] ([FLAT]) phone [PHONE] mail [EMAIL] see [URL]", [R("PHONE"), R("EMAIL"), R("URL"), R("FLAT"), R("NAME")]],
  ["nothing to take out", "The lift is slow in the mornings", ["Aamir Shaikh"], "The lift is slow in the mornings", []],
  ["empty", "", [], "", []],
  // PAN and vehicle registration numbers (A-004)
  ["a PAN", "ABCDE1234F", [], "[PAN]", [R("PAN")]],
  ["a PAN in lower case", "abcde1234f", [], "[PAN]", [R("PAN")]],
  ["a PAN in a sentence", "my pan is abcde1234f ok", [], "my pan is [PAN] ok", [R("PAN")]],
  ["a vehicle number", "MH12AB1234", [], "[VEHICLE]", [R("VEHICLE")]],
  ["a vehicle number with spaces", "MH 12 AB 1234", [], "[VEHICLE]", [R("VEHICLE")]],
  ["a vehicle number with hyphens", "MH-12-AB-1234", [], "[VEHICLE]", [R("VEHICLE")]],
  ["a vehicle number in lower case in a sentence", "car mh12ab1234 blocks the gate", [], "car [VEHICLE] blocks the gate", [R("VEHICLE")]],
  ["a one digit district and a three letter series", "MH2ABC1234 is parked", [], "[VEHICLE] is parked", [R("VEHICLE")]],
  ["a PAN and a vehicle number together", "PAN ABCDE1234F, car MH12AB1234", [], "PAN [PAN], car [VEHICLE]", [R("PAN"), R("VEHICLE")]],
  ["a Hindi complaint keeps its words", "टावर में पानी का रिसाव है, मेरा नंबर ९८७६५४३२१० है", [], "टावर में पानी का रिसाव है, मेरा नंबर [PHONE] है", [R("PHONE")]],
];

describe("CP3 deidentify: cases", () => {
  it("there are at least 40 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)("%s", (_label, input, names, expected, replacements) => {
    const out = deidentify(input, { knownNames: names });
    expect(out.text).toBe(expected);
    expect(out.replacements).toEqual(replacements);
  });

  it.each(CASES)("is idempotent: %s", (_label, input, names) => {
    const once = deidentify(input, { knownNames: names });
    const twice = deidentify(once.text, { knownNames: names });
    expect(twice.text).toBe(once.text);
    expect(twice.replacements).toEqual([]);
  });

  it("reports PAN and vehicle numbers between the web addresses and the flats", () => {
    const out = deidentify("Mr Rao T12-0408 a@b.com 9876543210 https://x.com ABCDE1234F MH12AB1234", { knownNames: [] });
    expect(out.replacements.map((r) => r.type)).toEqual(["PHONE", "EMAIL", "URL", "PAN", "VEHICLE", "FLAT", "NAME"]);
  });

  it("reports the kinds in a fixed order, only the ones that were replaced", () => {
    const out = deidentify("Mr Rao T12-0408 a@b.com 9876543210 https://x.com", { knownNames: [] });
    expect(out.replacements.map((r) => r.type)).toEqual(["PHONE", "EMAIL", "URL", "FLAT", "NAME"]);
  });

  it("does not throw on odd input, and does not change a text with nothing to take out", () => {
    expect(() => deidentify(undefined as unknown as string, { knownNames: [] })).not.toThrow();
    expect(() => deidentify("x", undefined as unknown as { knownNames: string[] })).not.toThrow();
    expect(() => deidentify("A.B (Test) [x]", { knownNames: ["A.B (Test)", "", "  ", 5 as unknown as string] })).not.toThrow();
    expect(() => deidentify("x".repeat(5000), { knownNames: ["x"] })).not.toThrow();
    expect(deidentify("plain words only", { knownNames: [] }).text).toBe("plain words only");
  });
});

describe("CP3 deidentify: properties over seeded random texts", () => {
  const FILLER = ["lift", "water", "leak", "tap", "बिजली", "पानी", "please", "urgent", "T12-0408", "t21 1601", "Mr Rao", "Aamir", "408", "27-10-2026", "10:30", "₹6,468", "a@b.com", "https://x.example/p", "🔥", "​"];
  const PREFIX = ["", "", "+91", "+91 ", "+91-", "91 ", "91", "0", "+९१ "];
  const SEPARATOR = ["", " ", "-", ".", "  "];

  function phone(rng: ReturnType<typeof createPrng>): string {
    const digits = Array.from({ length: 10 }, () => String(rng.int(0, 9))).join("");
    const devanagari = rng.chance(0.3);
    const show = (text: string) => (devanagari ? text.replace(/[0-9]/g, (d) => String.fromCharCode(0x0966 + Number(d))) : text);
    const separator = rng.pick(SEPARATOR);
    const shape = rng.int(0, 2);
    const body = shape === 0 ? digits : shape === 1 ? `${digits.slice(0, 5)}${separator}${digits.slice(5)}` : `${digits.slice(0, 3)}${separator}${digits.slice(3, 6)}${separator}${digits.slice(6)}`;
    return `${rng.pick(PREFIX)}${show(body)}`;
  }

  it("after deidentify no run of ten digits remains (ASCII or Devanagari, with or without separators), in 2,000 texts, never throws, and it is idempotent", () => {
    const rng = createPrng(20261108);
    const bare = /[0-9०-९]{10}/;
    const separated = /(?:[0-9०-९][\s\-.]{0,2}){10}/;
    for (let i = 0; i < 2000; i++) {
      const parts: string[] = [];
      const n = rng.int(2, 12);
      for (let j = 0; j < n; j++) parts.push(rng.chance(0.3) ? phone(rng) : rng.pick(FILLER));
      parts.push(phone(rng));
      const text = parts.join(rng.pick([" ", ", ", "\n", " and "]));
      const out = deidentify(text, { knownNames: ["Aamir Shaikh"] });
      expect(bare.test(out.text), `${text} -> ${out.text}`).toBe(false);
      expect(separated.test(out.text), `${text} -> ${out.text}`).toBe(false);
      expect(out.replacements.some((r) => r.type === "PHONE")).toBe(true);
      expect(deidentify(out.text, { knownNames: ["Aamir Shaikh"] }).text).toBe(out.text);
    }
  });
});

describe("CP3 deidentify: what a PAN or vehicle pattern must NOT take (A-004)", () => {
  const UNCHANGED = ["Tower 12 Flat 408", "AB1234", "12:30", "paid ₹6,468 on 27-10-2026", "Block A2", "lift stuck on floor 4", "fire in tower 3", "ordinary words only", "MH12AB12345", "XMH12AB1234", "ABCDE12345", "ABCDEF1234F", "the lift of tower 12 has stopped"];

  it.each(UNCHANGED)("%s is left as it is", (text) => {
    const out = deidentify(text, { knownNames: [] });
    expect(out.text).toBe(text);
    expect(out.replacements).toEqual([]);
  });

  it("a flat code is a flat, never a vehicle number or a PAN", () => {
    expect(deidentify("T12-0408", { knownNames: [] })).toEqual({ text: "[FLAT]", replacements: [R("FLAT")] });
  });
});

describe("CP3 deidentify: the cost of the PAN and vehicle patterns stays linear (A-004)", () => {
  const ADVERSARIAL = ["A1".repeat(2500), "AB 12 ".repeat(833), "MH12AB".repeat(833), "ab-1-".repeat(1000), "A".repeat(5000), "12 ab ".repeat(833), "MH 12 ABC ".repeat(500), "ABCDE1234".repeat(555)];

  /** The processor time of one deidentify call in milliseconds, the best of seven (processor time, not the clock, and the best run, so a busy machine does not decide it). */
  const cost = (text: string): number => {
    let best = Infinity;
    for (let run = 0; run < 7; run++) {
      const start = process.cpuUsage();
      deidentify(text, { knownNames: [] });
      const used = process.cpuUsage(start);
      best = Math.min(best, (used.user + used.system) / 1000);
    }
    return best;
  };

  it("a 5,000 character adversarial text costs under 50 ms more than a 5,000 character text with nothing in it (the rest of deidentify costs the same for both)", () => {
    const plain = cost("x".repeat(5000));
    for (const text of ADVERSARIAL) {
      expect(text.length).toBeGreaterThanOrEqual(4990);
      expect(cost(text) - plain, text.slice(0, 12)).toBeLessThan(50);
    }
  });
});
