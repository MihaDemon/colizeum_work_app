import { describe, expect, it } from "vitest";
import {
  dateLabel,
  time,
  money,
  parseAmount,
  validAmount,
} from "../src/lib/format";

describe("financial record dates", () => {
  it("shows calendar dates without a fabricated time", () => {
    expect(dateLabel("2026-10-12")).toBe("12 окт.");
  });
  it("keeps the Moscow timestamp for expenses", () => {
    expect(dateLabel("2026-10-11T22:30:00Z")).toContain("12 окт.");
    expect(time("2026-10-11T22:30:00Z")).toBe("01:30");
  });
});

describe("Russian monetary values", () => {
  it("uses Russian grouping and decimal separators", () => {
    expect(money(1234.5)).toBe("1\u00a0234,50 ₽");
    expect(money(1000)).toBe("1\u00a0000 ₽");
  });
  it("accepts a comma for Russian decimal input and retains dot compatibility", () => {
    expect(validAmount("125,50")).toBe(true);
    expect(parseAmount("125,50")).toBe(125.5);
    expect(validAmount("125.50")).toBe(true);
    for (const invalid of ["1,2,3", "-1", "1,001", "", "NaN"])
      expect(validAmount(invalid)).toBe(false);
  });
});
