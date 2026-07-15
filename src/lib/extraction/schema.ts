// The exact shape we force the AI to return when reading an invoice.
//
// This is a zod schema, which does double duty:
//   1. Structured outputs — the Anthropic API is *constrained* to return JSON that
//      matches this schema. The model literally cannot hand back a malformed line or
//      a missing field. That's the machine-level version of "never guess on money":
//      we don't parse hopeful free-text and pray, we get a validated object or an error.
//   2. TypeScript types — `ExtractedInvoice` below is derived from the schema, so the
//      rest of the pipeline is type-checked against the same definition the AI answers to.
//
// Matches design doc §2 (per-line shape) and §6 (per-line confidence → extraction status).

// Import zod v4 specifically. zod 3.25 ships both v3 (`zod`) and v4 (`zod/v4`), and the
// Anthropic SDK's `zodOutputFormat` helper is built against v4 — mixing them makes the
// schema type incompatible with the helper. Keep every extraction schema on `zod/v4`.
import { z } from "zod/v4";

// Weight/volume/count unit as it appears ON THE INVOICE — kg and l are allowed here
// because that's how suppliers write it ("5x1kg"). Normalising to canonical g/ml/unit
// is the costing layer's job later, not extraction's. Don't convert on the way in.
export const PackUnitSchema = z.enum(["g", "kg", "ml", "l", "unit"]);

// How legible/certain the AI was about THIS line — separate from whether we can later
// match it to an ingredient (design doc §2 is explicit about this distinction).
//   high / medium → a clean read, gets created as a normal line
//   low           → readable but uncertain (smudged price) → created, flagged for a look
//   unreadable    → the AI genuinely couldn't parse it → we DISREGARD it, never guess
//                   a number to fill the gap (design doc §6)
export const LineConfidenceSchema = z.enum(["high", "medium", "low", "unreadable"]);

export const ExtractedLineSchema = z.object({
  // Verbatim text as printed — "CHIX SUPREME 150-175G". This is what the matching
  // pipeline (next slice) will normalise and look up. Preserve it exactly.
  product_name_raw: z.string(),
  // How many units in the pack, e.g. 10. Null for a loose/single item.
  pack_count: z.number().nullable(),
  // Weight range per unit. If a single weight is printed, min == max (design doc §2).
  // Both null for a countable item with no weight ("6 x lettuce").
  unit_weight_min: z.number().nullable(),
  unit_weight_max: z.number().nullable(),
  unit: PackUnitSchema,
  // Prices as printed. Null if genuinely absent/illegible — never invented.
  unit_price: z.number().nullable(),
  total_price: z.number().nullable(),
  confidence: LineConfidenceSchema,
});

export const ExtractedInvoiceSchema = z.object({
  // Header fields. Null when not present on the document — a paper invoice may have
  // no number. We store what we can read and leave the rest honestly empty.
  supplier_name: z.string().nullable(),
  invoice_number: z.string().nullable(),
  // ISO date (YYYY-MM-DD) so it drops straight into a Postgres `date` column.
  invoice_date: z.string().nullable(),
  // Total line-items the AI could VISUALLY LOCATE on the page — the denominator of
  // Extraction % (design doc §6). This can exceed lines.length if some rows were seen
  // but too corrupt to parse into a structured line.
  lines_detected: z.number(),
  lines: z.array(ExtractedLineSchema),
});

export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
export type LineConfidence = z.infer<typeof LineConfidenceSchema>;

// Map the AI's per-line confidence onto the invoice_lines.extraction_status enum
// stored in the DB. Kept here, next to the schema, so the mapping is in one place.
//   high/medium → "extracted"   (counts toward lines_extracted)
//   low         → "low_confidence" (counts toward lines_extracted, but flagged)
//   unreadable  → null           (caller disregards the line entirely — never stored)
export function confidenceToExtractionStatus(
  c: LineConfidence
): "extracted" | "low_confidence" | null {
  if (c === "unreadable") return null;
  if (c === "low") return "low_confidence";
  return "extracted";
}
