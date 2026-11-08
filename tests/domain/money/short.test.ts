import { describe, expect, it } from "vitest";
import { formatRupeesShort } from "@/domain/money/short";

const rupees = (n: number) => BigInt(n) * 100n;

describe("formatRupeesShort", () => {
  const cases: [string, bigint, string][] = [
    ["zero", 0n, "₹0"],
    ["a small amount keeps the Indian grouping", rupees(6370), "₹6,370"],
    ["one paise below a lakh stays exact", 9_999_999n, "₹99,999.99"],
    ["99,999 rupees", rupees(99_999), "₹99,999"],
    ["1,00,000 rupees is one lakh", rupees(100_000), "₹1.0 lakh"],
    ["60.6 lakh", rupees(6_060_000), "₹60.6 lakh"],
    ["tie at the first decimal rounds up (1,05,000 rupees)", rupees(105_000), "₹1.1 lakh"],
    ["just below the tie rounds down (1,04,999 rupees)", rupees(104_999), "₹1.0 lakh"],
    ["99,99,999 rupees carries to a crore", rupees(9_999_999), "₹1.00 crore"],
    ["99,94,999 rupees stays in lakh", rupees(9_994_999), "₹99.9 lakh"],
    ["1,00,00,000 rupees is one crore", rupees(10_000_000), "₹1.00 crore"],
    ["1.49 crore", rupees(14_900_000), "₹1.49 crore"],
    ["tie at the second decimal rounds up (1,00,50,000 rupees)", rupees(10_050_000), "₹1.01 crore"],
    ["a figure of the seeded town", 1_805_219_000n, "₹1.81 crore"],
    ["a negative amount", -rupees(6_060_000), "-₹60.6 lakh"],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(formatRupeesShort(input)).toBe(expected);
  });
});
