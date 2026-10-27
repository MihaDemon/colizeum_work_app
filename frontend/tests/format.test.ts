import { describe, expect, it } from "vitest";
import { dateLabel, time } from "../src/lib/format";

describe("financial record dates", () => {
  it("shows calendar dates without a fabricated time", () => {
    expect(dateLabel("2026-10-12")).toBe("12 Oct");
  });
  it("keeps the Moscow timestamp for expenses", () => {
    expect(dateLabel("2026-10-11T22:30:00Z")).toContain("12 Oct");
    expect(time("2026-10-11T22:30:00Z")).toBe("01:30");
  });
});
