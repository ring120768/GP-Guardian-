// Tests for groupUnmatched(). Run with: npm test

import { describe, it, expect } from "vitest";
import { groupUnmatched, type QueueLine } from "./queue";

let n = 0;
const line = (o: Partial<QueueLine>): QueueLine => ({
  id: `L${++n}`,
  supplier_id: "S1",
  product_name_raw: "CHIX SUP 150-175G",
  unit_price: 17.9,
  price_basis: "per_pack",
  invoice_date: "2026-09-01",
  created_at: "2026-09-01T10:00:00Z",
  ...o,
});

describe("groupUnmatched", () => {
  it("asks once per product: same supplier + same name (any pack size) = one row", () => {
    const rows = groupUnmatched([
      line({ product_name_raw: "CHIX SUP 150-175G", invoice_date: "2026-09-01" }),
      line({ product_name_raw: "CHIX SUP 180-200G", invoice_date: "2026-09-15", unit_price: 19 }),
      line({ product_name_raw: "chix sup 150-175g", invoice_date: "2026-09-08" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      matchName: "chix sup",
      lineCount: 3,
      rawName: "CHIX SUP 180-200G",
    });
    expect(rows[0].latest.unit_price).toBe(19); // newest invoice's price
  });

  it("keeps different suppliers apart — their MINCE may not be the same thing", () => {
    const rows = groupUnmatched([line({ supplier_id: "S1" }), line({ supplier_id: "S2" })]);
    expect(rows).toHaveLength(2);
  });

  it("puts the biggest groups first", () => {
    const rows = groupUnmatched([
      line({ product_name_raw: "BUTTER" }),
      line({ product_name_raw: "MINCE" }),
      line({ product_name_raw: "MINCE" }),
    ]);
    expect(rows.map((r) => r.matchName)).toEqual(["mince", "butter"]);
  });
});
