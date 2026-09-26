// Tests for latestInvoiceRises(). Run with: npm test

import { describe, it, expect } from "vitest";
import { latestInvoiceRises } from "./rises";
import type { PriceLine } from "@/lib/prices/compare";

const line = (name: string, price: number, date: string): PriceLine => ({
  supplier_id: "S1",
  product_name_raw: name,
  price_basis: "per_pack",
  unit: "kg",
  pack_count: 1,
  unit_weight_min: 5,
  unit_weight_max: 5,
  unit_price: price,
  total_price: price,
  extraction_status: "extracted",
  invoice_number: date,
  invoice_date: date,
});

describe("latestInvoiceRises", () => {
  it("counts red and amber rises on the latest invoice only", () => {
    const linesByDoc = new Map([
      ["old", [line("MINCE", 10, "2026-09-01"), line("BACON", 10, "2026-09-01")]],
      ["mid", [line("MINCE", 12, "2026-09-08")]], // +20% — but not the latest invoice
      ["new", [line("MINCE", 14, "2026-09-15"), line("BACON", 10.5, "2026-09-15")]],
    ]);
    // Newest first. MINCE 12 → 14 = +16.7% (red); BACON 10 → 10.5 = +5% (amber).
    const counts = latestInvoiceRises([{ id: "new" }, { id: "mid" }, { id: "old" }], linesByDoc);
    expect(counts).toEqual({ red: 1, amber: 1 });
  });

  it("returns zeros for a supplier with no invoices", () => {
    expect(latestInvoiceRises([], new Map())).toEqual({ red: 0, amber: 0 });
  });
});
