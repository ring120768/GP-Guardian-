// Tests for comparePrices(). Run with: npm test
//
// The rule being protected: a price alert only fires when we're comparing the same
// product, from the same supplier, against an EARLIER invoice — and never invents a %.

import { describe, it, expect } from "vitest";
import { comparePrices, alertColour, type PriceLine } from "./compare";

// A typical per-pack line: 1 x 5kg of mince from supplier S1.
function line(overrides: Partial<PriceLine> = {}): PriceLine {
  return {
    supplier_id: "S1",
    product_name_raw: "BEEF MINCE 15% FAT",
    price_basis: "per_pack",
    unit: "kg",
    pack_count: 1,
    unit_weight_min: 5,
    unit_weight_max: 5,
    unit_price: 38.75,
    total_price: 38.75,
    extraction_status: "extracted",
    invoice_number: "INV-001",
    invoice_date: "2026-09-01",
    ...overrides,
  };
}

const LAST_WEEK = line();
const thisWeek = (o: Partial<PriceLine> = {}) =>
  line({ invoice_number: "INV-002", invoice_date: "2026-09-08", ...o });

describe("comparePrices", () => {
  it("flags a +16% rise as up / red", () => {
    const [r] = comparePrices([thisWeek({ unit_price: 44.95, total_price: 44.95 })], [LAST_WEEK]);
    expect(r.status).toBe("up");
    expect(r.previousPrice).toBe(38.75);
    expect(r.currentPrice).toBe(44.95);
    expect(r.changePct).toBeCloseTo(16.0, 1);
    expect(r.previousInvoiceNumber).toBe("INV-001");
    expect(r.previousDate).toBe("2026-09-01");
    expect(alertColour(r)).toBe("red");
  });

  it("flags a +6.5% rise as up / amber", () => {
    const prev = line({ unit_price: 10, total_price: 10 });
    const [r] = comparePrices([thisWeek({ unit_price: 10.65, total_price: 10.65 })], [prev]);
    expect(r.status).toBe("up");
    expect(r.changePct).toBeCloseTo(6.5, 1);
    expect(alertColour(r)).toBe("amber");
  });

  it("reports an unchanged price as same, with no colour", () => {
    const [r] = comparePrices([thisWeek()], [LAST_WEEK]);
    expect(r.status).toBe("same");
    expect(r.changePct).toBe(0);
    expect(alertColour(r)).toBeNull();
  });

  it("flags a drop as down / green", () => {
    const [r] = comparePrices([thisWeek({ unit_price: 35, total_price: 35 })], [LAST_WEEK]);
    expect(r.status).toBe("down");
    expect(r.changePct).toBeLessThan(0);
    expect(alertColour(r)).toBe("green");
  });

  it("reports pack_changed (no %) when a per-pack line's pack size differs", () => {
    const [r] = comparePrices(
      [thisWeek({ unit_weight_min: 6, unit_weight_max: 6, unit_price: 44.95 })],
      [LAST_WEEK]
    );
    expect(r.status).toBe("pack_changed");
    expect(r.changePct).toBeNull();
    expect(alertColour(r)).toBeNull();
  });

  it("skips a credit line (negative total)", () => {
    const [r] = comparePrices([thisWeek({ total_price: -38.75 })], [LAST_WEEK]);
    expect(r.status).toBe("skipped");
    expect(r.changePct).toBeNull();
  });

  it("skips a line with no unit price", () => {
    const [r] = comparePrices([thisWeek({ unit_price: null })], [LAST_WEEK]);
    expect(r.status).toBe("skipped");
  });

  it("returns new when there's no earlier invoice for that product", () => {
    // Only a SAME-DAY and a LATER line exist — neither counts as "previous".
    const sameDay = thisWeek({ invoice_number: "INV-OTHER", unit_price: 20 });
    const later = line({ invoice_date: "2026-09-15", unit_price: 99 });
    const [r] = comparePrices([thisWeek()], [sameDay, later, thisWeek()]);
    expect(r.status).toBe("new");
    expect(r.previousPrice).toBeNull();
  });

  it("uses the MOST RECENT earlier invoice, and ignores other suppliers", () => {
    const older = line({ invoice_number: "INV-000", invoice_date: "2026-08-25", unit_price: 30 });
    const otherSupplier = line({ supplier_id: "S2", invoice_date: "2026-09-05", unit_price: 1 });
    const [r] = comparePrices(
      [thisWeek({ product_name_raw: "  beef  mince 15% fat " })], // normalised to match
      [older, LAST_WEEK, otherSupplier]
    );
    expect(r.status).toBe("same");
    expect(r.previousInvoiceNumber).toBe("INV-001");
  });
});
