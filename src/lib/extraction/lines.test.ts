// Tests for the per-line validation in lines.ts.
// Run with: npm test
//
// The scenario these exist to protect is fixture INV-04: the AI put a catch weight
// ("2.84") into pack_count, Postgres rejected the whole insert because that column is an
// `integer`, and every line on the invoice was lost. The rule being tested is simple:
//
//   ONE BAD LINE COSTS YOU THAT LINE'S BAD FIELD. NOTHING ELSE.

import { describe, it, expect } from "vitest";
import { validateExtractedLine, buildInvoiceLineRows } from "./lines";
import type { ExtractedInvoice, ExtractedLine } from "./schema";

/** A clean, fully-readable line. Override just the bit each test cares about. */
function extractedLine(overrides: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    product_name_raw: "CHICKEN SUPREME 10x180g",
    pack_count: 10,
    qty_ordered: 2,
    unit_weight_min: 180,
    unit_weight_max: 180,
    unit: "g",
    unit_price: 16.8,
    total_price: 33.6,
    price_basis: "per_pack",
    status_note: null,
    confidence: "high",
    ...overrides,
  };
}

function invoice(lines: ExtractedLine[]): ExtractedInvoice {
  return {
    supplier_name: "Fictional Foods Ltd",
    invoice_number: "INV-04",
    invoice_date: "2026-09-18",
    lines_detected: lines.length,
    lines,
    delivery_charge: null,
    other_charges: [],
  };
}

const CTX = { venueId: "venue-1", documentId: "doc-1" };

describe("validateExtractedLine", () => {
  it("passes a clean line straight through as 'extracted'", () => {
    const result = validateExtractedLine(extractedLine());
    expect(result).not.toBeNull();
    expect(result!.extractionStatus).toBe("extracted");
    expect(result!.issues).toEqual([]);
    expect(result!.line.pack_count).toBe(10);
  });

  it("does not throw on a fractional pack_count — nulls it and flags the line", () => {
    // THE INV-04 BUG. 2.84 is a catch weight that landed in the wrong field.
    const result = validateExtractedLine(extractedLine({ pack_count: 2.84 }));

    expect(result).not.toBeNull();
    expect(result!.line.pack_count).toBeNull(); // nulled, NOT rounded to 3 — never invent
    expect(result!.extractionStatus).toBe("low_confidence"); // goes to the review queue
    expect(result!.issues).toHaveLength(1);
    expect(result!.issues[0]).toContain("2.84");
    // Everything else on the line survives intact — we only drop the unstorable field.
    expect(result!.line.unit_price).toBe(16.8);
    expect(result!.line.total_price).toBe(33.6);
  });

  it("nulls a non-finite price rather than storing garbage", () => {
    const result = validateExtractedLine(
      extractedLine({ unit_price: Number.NaN, total_price: Number.POSITIVE_INFINITY })
    );
    expect(result!.line.unit_price).toBeNull();
    expect(result!.line.total_price).toBeNull();
    expect(result!.extractionStatus).toBe("low_confidence");
    expect(result!.issues).toHaveLength(2);
  });

  it("disregards an 'unreadable' line instead of guessing at it (design doc §6)", () => {
    expect(validateExtractedLine(extractedLine({ confidence: "unreadable" }))).toBeNull();
  });

  it("disregards a line with no product name — nothing to match or review", () => {
    expect(validateExtractedLine(extractedLine({ product_name_raw: "   " }))).toBeNull();
  });

  it("keeps a 0 qty_ordered (short delivery) and a negative one (credit)", () => {
    // 0 and negative are MEANINGFUL here, so they must not be mistaken for missing.
    expect(validateExtractedLine(extractedLine({ qty_ordered: 0 }))!.line.qty_ordered).toBe(0);
    expect(validateExtractedLine(extractedLine({ qty_ordered: -1 }))!.line.qty_ordered).toBe(-1);
  });

  it("keeps a low-confidence line as low_confidence, with nothing to repair", () => {
    const result = validateExtractedLine(extractedLine({ confidence: "low" }));
    expect(result!.extractionStatus).toBe("low_confidence");
    expect(result!.issues).toEqual([]);
  });
});

describe("buildInvoiceLineRows", () => {
  it("saves the rest of the invoice when one line has a bad pack_count", () => {
    // This is the whole point of the fix. Four lines, one poisoned by a catch weight in
    // pack_count. Before: Postgres rejected the statement and all four were lost.
    const doc = invoice([
      extractedLine({ product_name_raw: "CHICKEN SUPREME 10x180g" }),
      extractedLine({ product_name_raw: "PORK BELLY", pack_count: 2.84 }), // the bad one
      extractedLine({ product_name_raw: "BEEF MINCE 5kg" }),
      extractedLine({ product_name_raw: "BUTTER 25x250g" }),
    ]);

    const { rows, linesDisregarded } = buildInvoiceLineRows(doc, CTX);

    expect(rows).toHaveLength(4); // nothing lost
    expect(linesDisregarded).toBe(0); // nothing thrown away either

    const pork = rows.find((r) => r.product_name_raw === "PORK BELLY")!;
    expect(pork.pack_count).toBeNull();
    expect(pork.extraction_status).toBe("low_confidence");
    // The chef can see WHY that field is blank, rather than assuming it wasn't printed.
    expect(pork.status_note).toContain("2.84");

    // The other three are untouched and clean.
    const others = rows.filter((r) => r.product_name_raw !== "PORK BELLY");
    expect(others).toHaveLength(3);
    for (const row of others) {
      expect(row.extraction_status).toBe("extracted");
      expect(row.pack_count).toBe(10);
      expect(row.status_note).toBeNull();
    }
  });

  it("counts disregarded lines and still returns the readable ones", () => {
    const doc = invoice([
      extractedLine({ product_name_raw: "BUTTER 25x250g" }),
      extractedLine({ confidence: "unreadable" }),
      extractedLine({ product_name_raw: "" }),
    ]);

    const { rows, linesDisregarded } = buildInvoiceLineRows(doc, CTX);
    expect(rows).toHaveLength(1);
    expect(linesDisregarded).toBe(2);
  });

  it("carries price_basis, qty_ordered and the supplier's status label onto the row", () => {
    const doc = invoice([
      extractedLine({
        product_name_raw: "PORK BELLY",
        price_basis: "per_kg", // £7.95 PER KG…
        unit: "kg",
        unit_weight_min: 3.42, // …with 3.42kg actually delivered (catch weight)
        unit_weight_max: 3.42,
        unit_price: 7.95,
        pack_count: null,
        qty_ordered: 0,
        status_note: "SHORT",
      }),
    ]);

    const [row] = buildInvoiceLineRows(doc, CTX).rows;
    expect(row.price_basis).toBe("per_kg");
    expect(row.unit_weight_min).toBe(3.42);
    expect(row.qty_ordered).toBe(0);
    expect(row.status_note).toBe("SHORT"); // kept out of product_name_raw
    expect(row.product_name_raw).toBe("PORK BELLY");
    // Never finalised on the way in — a human confirms (principle #2).
    expect(row.match_confidence).toBe("unmatched");
    expect(row.venue_id).toBe("venue-1");
    expect(row.document_id).toBe("doc-1");
  });

  it("keeps the supplier's label AND our repair note when both apply", () => {
    const doc = invoice([
      extractedLine({ status_note: "NOT DELIVERED", pack_count: 1.5 }),
    ]);
    const [row] = buildInvoiceLineRows(doc, CTX).rows;
    expect(row.status_note).toContain("NOT DELIVERED");
    expect(row.status_note).toContain("1.5");
  });
});
