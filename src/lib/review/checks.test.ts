// Tests for lineMathCheck(). Run with: npm test
//
// The rules being protected: sums are checked to the penny (±1p), credits check
// correctly, and a line we CAN'T check is never flagged as wrong.

import { describe, it, expect } from "vitest";
import { lineMathCheck, type MathCheckLine } from "./checks";

const line = (o: Partial<MathCheckLine>): MathCheckLine => ({
  price_basis: "per_pack",
  qty_ordered: null,
  unit_weight_min: null,
  unit_price: null,
  total_price: null,
  ...o,
});

describe("lineMathCheck", () => {
  it("passes bacon: 3 × £9.20 = £27.60", () => {
    const r = lineMathCheck(line({ qty_ordered: 3, unit_price: 9.2, total_price: 27.6 }));
    expect(r.ok).toBe(true);
    expect(r.expectedTotal).toBeCloseTo(27.6, 10);
    expect(r.message).toBeNull();
  });

  it("passes pork belly per kg: 3.42kg × £7.95 = £27.19 (27.189 rounds)", () => {
    const r = lineMathCheck(
      line({ price_basis: "per_kg", unit_weight_min: 3.42, unit_price: 7.95, total_price: 27.19 })
    );
    expect(r.ok).toBe(true);
    expect(r.expectedTotal).toBeCloseTo(27.189, 10);
  });

  it("flags a total that doesn't add up", () => {
    const r = lineMathCheck(line({ qty_ordered: 3, unit_price: 9.2, total_price: 28.6 }));
    expect(r.ok).toBe(false);
    expect(r.expectedTotal).toBeCloseTo(27.6, 10);
    expect(r.message).toMatch(/£27\.60.*£28\.60/);
  });

  it("does not flag a line with no qty — can't check isn't wrong", () => {
    const r = lineMathCheck(line({ qty_ordered: null, unit_price: 9.2, total_price: 99 }));
    expect(r).toEqual({ ok: true, expectedTotal: null, message: null });
  });

  it("does not flag a line with no price basis", () => {
    const r = lineMathCheck(
      line({ price_basis: null, qty_ordered: 3, unit_price: 9.2, total_price: 99 })
    );
    expect(r.expectedTotal).toBeNull();
    expect(r.ok).toBe(true);
  });

  it("passes a credit: -1 × £18.60 = -£18.60", () => {
    const r = lineMathCheck(line({ qty_ordered: -1, unit_price: 18.6, total_price: -18.6 }));
    expect(r.ok).toBe(true);
    expect(r.expectedTotal).toBeCloseTo(-18.6, 10);
  });

  it("passes a per-kg credit, taking the sign from qty_ordered", () => {
    const r = lineMathCheck(
      line({
        price_basis: "per_kg",
        qty_ordered: -1,
        unit_weight_min: 3.42,
        unit_price: 7.95,
        total_price: -27.19,
      })
    );
    expect(r.ok).toBe(true);
  });

  it("allows 1p of rounding, but not 2p", () => {
    expect(lineMathCheck(line({ qty_ordered: 3, unit_price: 9.2, total_price: 27.61 })).ok).toBe(
      true
    );
    expect(lineMathCheck(line({ qty_ordered: 3, unit_price: 9.2, total_price: 27.62 })).ok).toBe(
      false
    );
  });
});
