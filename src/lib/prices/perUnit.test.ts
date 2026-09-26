// Tests for pricePerUnit() / latestPricePerUnit(). Run with: npm test
//
// Every price is worked out by hand in the comment, so a failure can be checked on paper.

import { describe, it, expect } from "vitest";
import { pricePerUnit, latestPricePerUnit, type PerUnitLine } from "./perUnit";

const line = (o: Partial<PerUnitLine>): PerUnitLine => ({
  price_basis: "per_pack",
  qty_ordered: 1,
  pack_count: null,
  unit_weight_min: null,
  unit_weight_max: null,
  unit: "kg",
  unit_price: null,
  total_price: null,
  ...o,
});

describe("pricePerUnit", () => {
  it("per pack, kg: 1 × 5kg mince for £38.75 → £7.75/kg", () => {
    const r = pricePerUnit(line({ unit_weight_min: 5, unit_weight_max: 5, total_price: 38.75 }));
    expect(r).toMatchObject({ ok: true, per: "kg", estimated: false });
    if (r.ok) expect(r.price).toBeCloseTo(7.75);
  });

  it("per pack, grams with a count: 2 × (10 × 250g) butter for £45 → £9/kg", () => {
    // 2 × 10 × 250g = 5kg → £45 ÷ 5 = £9
    const r = pricePerUnit(
      line({
        qty_ordered: 2,
        pack_count: 10,
        unit: "g",
        unit_weight_min: 250,
        unit_weight_max: 250,
        total_price: 45,
      })
    );
    if (!r.ok) throw new Error(r.note);
    expect(r.price).toBeCloseTo(9);
    expect(r.per).toBe("kg");
  });

  it("per pack, weight range → midpoint, flagged estimated", () => {
    // 10 × 150–175g → 10 × 162.5g = 1.625kg; £17.90 ÷ 1.625 = £11.02/kg
    const r = pricePerUnit(
      line({
        pack_count: 10,
        unit: "g",
        unit_weight_min: 150,
        unit_weight_max: 175,
        total_price: 17.9,
      })
    );
    if (!r.ok) throw new Error(r.note);
    expect(r.price).toBeCloseTo(11.015, 2);
    expect(r.estimated).toBe(true);
  });

  it("per pack, litres: 1 × 20L oil for £32.50 → £1.625/L", () => {
    const r = pricePerUnit(
      line({ unit: "l", unit_weight_min: 20, unit_weight_max: 20, total_price: 32.5 })
    );
    expect(r).toMatchObject({ ok: true, per: "L" });
    if (r.ok) expect(r.price).toBeCloseTo(1.625);
  });

  it("per pack, count items: 1 × 180 eggs for £18.60 → £0.103 each", () => {
    const r = pricePerUnit(line({ unit: "unit", pack_count: 180, total_price: 18.6 }));
    expect(r).toMatchObject({ ok: true, per: "each" });
    if (r.ok) expect(r.price).toBeCloseTo(0.1033, 3);
  });

  it("per kg → the unit price is the price per kg", () => {
    expect(
      pricePerUnit(line({ price_basis: "per_kg", unit_price: 8.45, total_price: 30.5 }))
    ).toEqual({
      ok: true,
      price: 8.45,
      per: "kg",
      estimated: false,
    });
  });

  it("per litre → price per L", () => {
    expect(
      pricePerUnit(line({ price_basis: "per_litre", unit: "l", unit_price: 2.05 }))
    ).toMatchObject({
      ok: true,
      price: 2.05,
      per: "L",
    });
  });

  it("per unit → price each", () => {
    expect(
      pricePerUnit(line({ price_basis: "per_unit", unit: "unit", unit_price: 0.35 }))
    ).toMatchObject({
      ok: true,
      price: 0.35,
      per: "each",
    });
  });

  it("missing data → a note, never a guess", () => {
    expect(pricePerUnit(line({ price_basis: null }))).toEqual({
      ok: false,
      note: "price basis not read",
    });
    expect(pricePerUnit(line({ total_price: 38.75 }))).toEqual({
      ok: false,
      note: "pack weight not read",
    });
    expect(pricePerUnit(line({ unit_weight_min: 5, unit_weight_max: 5 }))).toEqual({
      ok: false,
      note: "line total not read",
    });
    expect(
      pricePerUnit(
        line({ qty_ordered: null, unit_weight_min: 5, unit_weight_max: 5, total_price: 9 })
      )
    ).toMatchObject({ ok: false });
    expect(pricePerUnit(line({ price_basis: "per_kg" }))).toEqual({
      ok: false,
      note: "unit price not read",
    });
  });

  it("credits and short deliveries give no price", () => {
    expect(
      pricePerUnit(
        line({ qty_ordered: -1, unit_weight_min: 5, unit_weight_max: 5, total_price: -38.75 })
      )
    ).toMatchObject({ ok: false });
    expect(
      pricePerUnit(line({ qty_ordered: 0, unit_weight_min: 5, unit_weight_max: 5, total_price: 0 }))
    ).toMatchObject({ ok: false });
  });
});

describe("latestPricePerUnit", () => {
  it("uses the newest line that gives a price, skipping a newer credit", () => {
    const credit = line({
      qty_ordered: -1,
      unit_weight_min: 5,
      unit_weight_max: 5,
      total_price: -38.75,
    });
    const good = line({ unit_weight_min: 5, unit_weight_max: 5, total_price: 40 });
    const r = latestPricePerUnit([credit, good]);
    if (!r.ok) throw new Error(r.note);
    expect(r.price).toBeCloseTo(8);
  });

  it("explains why when no line gives a price", () => {
    expect(latestPricePerUnit([line({ price_basis: null })])).toEqual({
      ok: false,
      note: "price basis not read",
    });
    expect(latestPricePerUnit([])).toEqual({ ok: false, note: "not on any invoice yet" });
  });
});
