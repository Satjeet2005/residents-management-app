import { describe, expect, it } from "vitest";
import { isDemoPhone, normalizePhone } from "@/domain/auth/phone";

describe("AU1 normalizePhone", () => {
  it.each([
    ["+91 98765 43210", "9876543210"],
    ["91-9876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["98765-43210", "9876543210"],
    ["(98765) 43210", "9876543210"],
    ["  9876543210  ", "9876543210"],
    ["9876543210", "9876543210"],
    ["+919876543210", "9876543210"],
    ["919876543210", "9876543210"],
    ["+91-98765-43210", "9876543210"],
    ["+91 (98765) 43210", "9876543210"],
    ["0 98765 43210", "9876543210"],
    ["\t98765 43210\n", "9876543210"],
    ["5000000001", "5000000001"],
    ["+91 50000 00001", "5000000001"],
    ["6000000000", "6000000000"],
    ["7123456789", "7123456789"],
    ["8999999999", "8999999999"],
    ["9187654321", "9187654321"],
    ["09187654321", "9187654321"],
    ["+91 91876 54321", "9187654321"],
  ])("accepts %j as %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["   ", "only spaces"],
    ["+", "only a plus"],
    ["987654321", "9 digits"],
    ["98765432101", "11 digits not starting with 0"],
    ["987654321012", "12 digits not starting with 91"],
    ["+91 987654321", "9 national digits after +91"],
    ["+91 98765432101", "11 national digits after +91"],
    ["+1 9876543210", "country code 1"],
    ["+1 415 555 0132", "a US number"],
    ["+44 7911 123456", "a UK number"],
    ["+91 +91 9876543210", "two country codes"],
    ["98765 4321O", "a letter O for a zero"],
    ["phone 9876543210", "letters"],
    ["9876543210x", "trailing letter"],
    ["98765.43210", "a dot"],
    ["98765/43210", "a slash"],
    ["9876 543 210 ext 5", "an extension"],
    ["4876543210", "first digit 4"],
    ["1234567890", "first digit 1"],
    ["0123456789", "leading 0 then a 1"],
    ["+91 4876543210", "first digit 4 after +91"],
    ["914876543210", "first digit 4 after 91"],
    ["0000000000", "all zeros"],
    ["+9876543210", "a plus without the 91 prefix"],
    ["98765+43210", "a plus in the middle"],
    ["0091 9876543210", "00 international prefix"],
    ["009876543210", "two leading zeros"],
    ["٩٨٧٦٥٤٣٢١٠", "Arabic-Indic digits"],
    ["９８７６５４３２１０", "full-width digits"],
    ["९८७६५४३२१०", "Devanagari digits"],
  ])("rejects %j (%s)", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("AU1 isDemoPhone", () => {
  it.each([
    ["5000000001", true],
    ["5999999999", true],
    ["6000000000", false],
    ["9876543210", false],
  ])("%s is demo: %s", (phone, expected) => {
    expect(isDemoPhone(phone)).toBe(expected);
  });
});
