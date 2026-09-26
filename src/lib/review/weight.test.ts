// Tests for parseWeight() / formatWeightInput(). Run with: npm test

import { describe, it, expect } from "vitest";
import { parseWeight, formatWeightInput } from "./weight";

describe("parseWeight", () => {
  it("reads a fixed weight as min = max", () => {
    expect(parseWeight("5")).toEqual({ ok: true, min: 5, max: 5 });
    expect(parseWeight(" 3.61 ")).toEqual({ ok: true, min: 3.61, max: 3.61 });
  });

  it("reads a range, with a hyphen or en dash and optional spaces", () => {
    expect(parseWeight("150-175")).toEqual({ ok: true, min: 150, max: 175 });
    expect(parseWeight("150 – 175")).toEqual({ ok: true, min: 150, max: 175 });
  });

  it("treats blank as not printed (null), never 0", () => {
    expect(parseWeight("")).toEqual({ ok: true, min: null, max: null });
  });

  it("rejects a backwards range", () => {
    const r = parseWeight("175-150");
    expect(r.ok).toBe(false);
  });

  it("rejects junk", () => {
    for (const junk of ["abc", "5kg", "-5", "150-", "1-2-3", "5,5"]) {
      expect(parseWeight(junk).ok, junk).toBe(false);
    }
  });
});

describe("formatWeightInput", () => {
  it("round-trips fixed, range and blank", () => {
    expect(formatWeightInput(5, 5)).toBe("5");
    expect(formatWeightInput(150, 175)).toBe("150-175");
    expect(formatWeightInput(null, null)).toBe("");
  });
});
