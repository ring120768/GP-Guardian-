// "What does this ingredient cost per kg / per litre / each?" — from one invoice line.
//
// Invoices price things every which way (£38.75 for a 5kg pack, £8.45/kg, 35p each).
// This turns one line into a comparable price so the ingredients page can show it.
//
//   per_pack   → line total ÷ (qty × pack count × pack weight in kg or L)
//                (count items: line total ÷ (qty × pack count) = price each)
//   per_kg     → the unit price IS the price per kg
//   per_litre  → the unit price IS the price per litre
//   per_unit   → the unit price IS the price each
//
// NEVER GUESS: anything missing gives { ok: false, note } saying what, and the page
// shows "—". The one estimate allowed is design doc §4's: a weight RANGE (150–175g)
// uses its midpoint, flagged `estimated` so the page can show "≈".
//
// Pure — unit tested in perUnit.test.ts.

import type { InvoiceLine } from "@/types/database";

export type PerUnitLine = Pick<
  InvoiceLine,
  | "price_basis"
  | "qty_ordered"
  | "pack_count"
  | "unit_weight_min"
  | "unit_weight_max"
  | "unit"
  | "unit_price"
  | "total_price"
>;

export type PerUnit = "kg" | "L" | "each";

export type PerUnitPrice =
  { ok: true; price: number; per: PerUnit; estimated: boolean } | { ok: false; note: string };

const fail = (note: string): PerUnitPrice => ({ ok: false, note });

export function pricePerUnit(line: PerUnitLine): PerUnitPrice {
  // A credit/return tells you what was refunded, not what the product costs.
  if (line.total_price !== null && line.total_price < 0) return fail("latest line is a credit");

  switch (line.price_basis) {
    case null:
      return fail("price basis not read");

    case "per_kg":
    case "per_litre":
    case "per_unit": {
      if (line.unit_price === null) return fail("unit price not read");
      const per: PerUnit =
        line.price_basis === "per_kg" ? "kg" : line.price_basis === "per_litre" ? "L" : "each";
      return { ok: true, price: line.unit_price, per, estimated: false };
    }

    case "per_pack": {
      if (line.total_price === null) return fail("line total not read");
      if (line.qty_ordered === null) return fail("quantity not read");
      if (line.qty_ordered <= 0) return fail("nothing delivered on the latest line");
      // pack_count null = a single item, not an unknown (see the extraction schema).
      const packs = line.pack_count ?? 1;

      if (line.unit === "unit") {
        const count = line.qty_ordered * packs;
        return { ok: true, price: line.total_price / count, per: "each", estimated: false };
      }

      const { unit_weight_min: min, unit_weight_max: max } = line;
      if (min === null || max === null) return fail("pack weight not read");
      const weight = (min + max) / 2; // same as min when it's a fixed weight
      const estimated = min !== max;

      // To kg or litres, so every weighed price reads the same way.
      const toBase = line.unit === "g" || line.unit === "ml" ? 1 / 1000 : 1;
      const per: PerUnit = line.unit === "ml" || line.unit === "l" ? "L" : "kg";
      const amount = line.qty_ordered * packs * weight * toBase;
      if (amount <= 0) return fail("pack weight is zero");

      return { ok: true, price: line.total_price / amount, per, estimated };
    }
  }
}

/**
 * The newest line that gives a price. If none does, the newest line's reason — so the
 * page can say WHY there's no price ("pack weight not read"), not just "—".
 */
export function latestPricePerUnit(linesNewestFirst: PerUnitLine[]): PerUnitPrice {
  if (linesNewestFirst.length === 0) return fail("not on any invoice yet");
  let firstFailure: PerUnitPrice | null = null;
  for (const line of linesNewestFirst) {
    const result = pricePerUnit(line);
    if (result.ok) return result;
    firstFailure ??= result;
  }
  return firstFailure!;
}
