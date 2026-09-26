// Tests for describeLine(). Run with: npm test
//
// The rule being protected: the sentence says exactly what's stored, and anything
// missing shows as "?" — never an invented number.

import { describe, it, expect } from "vitest";
import { describeLine, type DescribeLine } from "./describe";

const line = (o: Partial<DescribeLine>): DescribeLine => ({
  product_name_raw: "PRODUCT",
  qty_ordered: null,
  pack_count: null,
  unit_weight_min: null,
  unit_weight_max: null,
  unit: "kg",
  price_basis: "per_pack",
  unit_price: null,
  total_price: null,
  ...o,
});

describe("describeLine", () => {
  it("per pack, with a pack count and a weight range", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "CHIX SUPREME SKIN-ON 150-175G",
          qty_ordered: 2,
          pack_count: 10,
          unit_weight_min: 150,
          unit_weight_max: 175,
          unit: "g",
          unit_price: 17.9,
          total_price: 35.8,
        })
      )
    ).toBe("CHIX SUPREME SKIN-ON 150-175G · 2 × (10 × 150–175g) @ £17.90/pack = £35.80");
  });

  it("per pack, single fixed weight — no brackets", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "BEEF MINCE",
          qty_ordered: 1,
          unit_weight_min: 5,
          unit_weight_max: 5,
          unit_price: 38.75,
          total_price: 38.75,
        })
      )
    ).toBe("BEEF MINCE · 1 × 5kg @ £38.75/pack = £38.75");
  });

  it("per kg catch weight", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "PORK BELLY BONELESS",
          qty_ordered: 1,
          unit_weight_min: 3.61,
          unit_weight_max: 3.61,
          price_basis: "per_kg",
          unit_price: 8.45,
          total_price: 30.5,
        })
      )
    ).toBe("PORK BELLY BONELESS · 3.61kg @ £8.45/kg = £30.50");
  });

  it("per litre", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "DOUBLE CREAM",
          unit: "l",
          unit_weight_min: 2,
          unit_weight_max: 2,
          price_basis: "per_litre",
          unit_price: 4.1,
          total_price: 8.2,
        })
      )
    ).toBe("DOUBLE CREAM · 2L @ £4.10/litre = £8.20");
  });

  it("shows litres as a capital L, so 20L can't be misread as 201", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "RAPESEED OIL",
          qty_ordered: 1,
          unit: "l",
          unit_weight_min: 20,
          unit_weight_max: 20,
          unit_price: 32.5,
          total_price: 32.5,
        })
      )
    ).toBe("RAPESEED OIL · 1 × 20L @ £32.50/pack = £32.50");
  });

  it("count items with no weight read 'N each' — no '× ?'", () => {
    const eggs = line({
      product_name_raw: "FREE RANGE EGGS",
      qty_ordered: -1,
      pack_count: 180,
      unit: "unit",
      unit_price: 18.6,
      total_price: -18.6,
    });
    expect(describeLine(eggs)).toBe("FREE RANGE EGGS · -1 × 180 each @ £18.60/pack = -£18.60");

    const blueRoll = line({
      product_name_raw: "BLUE ROLL",
      qty_ordered: 1,
      pack_count: 6,
      unit: "unit",
      unit_price: 14.99,
      total_price: 14.99,
    });
    expect(describeLine(blueRoll)).toBe("BLUE ROLL · 1 × 6 each @ £14.99/pack = £14.99");
  });

  it("per unit", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "LEMONS",
          unit: "unit",
          qty_ordered: 12,
          price_basis: "per_unit",
          unit_price: 0.35,
          total_price: 4.2,
        })
      )
    ).toBe("LEMONS · 12 @ £0.35 each = £4.20");
  });

  it("a credit shows negative", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "SALMON SIDE",
          qty_ordered: -1,
          unit_weight_min: 1.5,
          unit_weight_max: 1.5,
          unit_price: 18.6,
          total_price: -18.6,
        })
      )
    ).toBe("SALMON SIDE · -1 × 1.5kg @ £18.60/pack = -£18.60");
  });

  it("a per-kg credit takes its sign from qty", () => {
    expect(
      describeLine(
        line({
          qty_ordered: -1,
          unit_weight_min: 3.42,
          unit_weight_max: 3.42,
          price_basis: "per_kg",
          unit_price: 7.95,
          total_price: -27.19,
        })
      )
    ).toBe("PRODUCT · -3.42kg @ £7.95/kg = -£27.19");
  });

  it("a SHORT line (qty 0)", () => {
    expect(
      describeLine(
        line({
          product_name_raw: "CHICKEN THIGHS",
          qty_ordered: 0,
          unit_weight_min: 5,
          unit_weight_max: 5,
          unit_price: 16.8,
          total_price: 0,
        })
      )
    ).toBe("CHICKEN THIGHS · 0 × 5kg @ £16.80/pack = £0.00");
  });

  it("shows ? for anything missing — never invents a number", () => {
    expect(describeLine(line({ product_name_raw: "MYSTERY", price_basis: null }))).toBe(
      "MYSTERY · ? @ ?/? = ?"
    );
    expect(
      describeLine(line({ pack_count: 12, qty_ordered: 1, unit_price: 9, total_price: 9 }))
    ).toBe("PRODUCT · 1 × (12 × ?) @ £9.00/pack = £9.00");
    expect(describeLine(line({ price_basis: "per_kg", unit_price: 8 }))).toBe(
      "PRODUCT · ? @ £8.00/kg = ?"
    );
  });
});
