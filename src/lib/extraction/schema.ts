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

// WHAT THE PRICE IS PER — the single most important thing we were missing.
//
// Two lines can look almost identical on paper and mean very different money:
//
//   PORK BELLY   £7.95   kg   3.42   → £7.95 PER KG, 3.42kg delivered → £27.19
//   BEEF MINCE   £38.75  kg   5      → £38.75 for the whole 5kg PACK  → £38.75
//
// Without this field the costing layer has to guess which one it's looking at, and a
// guess here is a 3–5x error on a food cost. So the AI must tell us the basis, and if
// it genuinely can't tell, it says so (null) rather than picking one — same rule as
// every other number in this app.
//   per_pack  → the price buys the whole pack as sold (the common case)
//   per_kg    → price is per kilogram; the delivered weight is a separate number
//   per_litre → price is per litre
//   per_unit  → price is per single countable item ("each")
export const PriceBasisSchema = z.enum(["per_pack", "per_kg", "per_litre", "per_unit"]);

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
  //
  // .int() is load-bearing, not decorative. `invoice_lines.pack_count` is a Postgres
  // `integer` column, so a fractional value here is rejected by the database — and
  // because we insert a whole invoice in one statement, ONE bad value used to lose
  // EVERY line on that invoice (fixture INV-04: the AI put the catch weight "2.84"
  // in here). Constraining it in the schema means the structured-output API refuses
  // to hand back a non-integer in the first place. Belt and braces: lines.ts also
  // checks it before insert, because a schema is a contract and contracts get changed.
  pack_count: z.number().int().nullable(),
  // How many of this product were ORDERED — the "2" in "2 x chicken @ £16.80 = £33.60".
  // Without it we can't tell a single item from a dozen, and the line total stops
  // reconciling. Not an integer: some products are ordered by weight ("1.5" cases).
  //   negative → a credit / returned goods
  //   0        → short-delivered or not delivered at all (see status_note)
  //   null     → genuinely not printed on the invoice
  qty_ordered: z.number().nullable(),
  // Weight range per unit. If a single weight is printed, min == max (design doc §2).
  // Both null for a countable item with no weight ("6 x lettuce").
  unit_weight_min: z.number().nullable(),
  unit_weight_max: z.number().nullable(),
  unit: PackUnitSchema,
  // Prices as printed. Null if genuinely absent/illegible — never invented.
  unit_price: z.number().nullable(),
  total_price: z.number().nullable(),
  // What unit_price is PER (see PriceBasisSchema above). Null when the invoice layout
  // genuinely doesn't say — better an honest gap than a 5x costing error.
  price_basis: PriceBasisSchema.nullable(),
  // Supplier status labels printed against the line — "SHORT", "NOT DELIVERED",
  // "OUT OF STOCK", "CREDIT". These used to get swept into product_name_raw, which
  // quietly broke ingredient matching ("CHICKEN SUPREME SHORT" matches nothing). They
  // live here instead so the product name stays clean and the note stays visible.
  status_note: z.string().nullable(),
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
  // ── Invoice-level charges — NOT product lines ──────────────────────────────
  // Delivery, fuel surcharge and small-order fees are real money that must land in
  // the invoice total, but they are not ingredients: costed as a product line they'd
  // show up as an unmatchable "DELIVERY" ingredient in the chef's review queue every
  // single week. So they're captured at the document level instead.
  delivery_charge: z.number().nullable(),
  // Anything else non-product: fuel surcharge, small-order fee, pallet/crate deposit.
  // Empty array when there are none.
  other_charges: z.array(
    z.object({
      label: z.string(), // as printed, e.g. "Fuel surcharge"
      amount: z.number(), // negative for a discount/credit line
    })
  ),
});

export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
export type LineConfidence = z.infer<typeof LineConfidenceSchema>;
export type PriceBasis = z.infer<typeof PriceBasisSchema>;
export type OtherCharge = ExtractedInvoice["other_charges"][number];

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
