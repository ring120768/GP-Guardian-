// Turning extracted AI lines into safe database rows — one line at a time.
//
// WHY THIS FILE EXISTS
//
// Fixture INV-04 taught us this the hard way. The AI read a catch-weight line and put
// "2.84" into pack_count. `invoice_lines.pack_count` is a Postgres `integer` column, we
// insert the whole invoice in a single statement, so Postgres rejected the statement —
// and ALL 11 lines of that invoice were lost. One bad field, entire invoice gone.
//
// That is the worst possible failure shape for this app: silent, total, and it looks
// like "the AI couldn't read it" rather than "we threw away good data". So:
//
//   Every line is checked on its own before it goes anywhere near the database.
//   A line we can't store perfectly is stored IMPERFECTLY AND FLAGGED, never guessed
//   at, and never allowed to take its neighbours down with it.
//
// This file is deliberately pure — no Supabase, no `server-only`, no network. It takes
// an ExtractedInvoice and returns plain row objects, which is what makes it unit
// testable (see lines.test.ts). The actual inserting lives in pipeline.ts.

import type { ExtractedInvoice, ExtractedLine } from "./schema";
import { confidenceToExtractionStatus } from "./schema";

/** A line that survived validation, plus what we had to do to it to make it storable. */
export interface ValidatedLine {
  /** A sanitised COPY of the line — unstorable values replaced with null, never fudged. */
  line: ExtractedLine;
  /**
   * 'extracted'      → stored clean, nothing was wrong with it.
   * 'low_confidence' → stored, but we nulled a field or the AI was unsure. Needs eyes.
   */
  extractionStatus: "extracted" | "low_confidence";
  /**
   * Plain-English notes about what we changed, e.g.
   * `pack count "2.84" isn't a whole number`. Empty when the line was clean.
   * These get appended to status_note so a nulled field doesn't look identical to a
   * field the invoice never printed — the chef can see WHY it's blank.
   */
  issues: string[];
}

/**
 * Is this a number Postgres will actually accept in a `numeric` column?
 * Guards against NaN / Infinity, which JSON can't carry but a bad parse can produce.
 */
function isStorableNumber(v: number | null): v is number {
  return v !== null && Number.isFinite(v);
}

/**
 * Check ONE extracted line and make it safe to insert.
 *
 * Returns null when the line should be disregarded entirely (counted in
 * lines_disregarded, never invented — design doc §6):
 *   • confidence 'unreadable' — the AI told us it couldn't parse it.
 *   • no product name at all  — nothing identifiable to review or match later.
 *
 * Otherwise returns the line with any unstorable value replaced by null and, if we had
 * to do that, demoted to 'low_confidence' so it lands in the review queue.
 *
 * Never throws. That's the whole point: a validator that throws on bad input is just
 * the original bug with extra steps.
 */
export function validateExtractedLine(raw: ExtractedLine): ValidatedLine | null {
  // The AI's own verdict comes first — if it says unreadable, we disregard it.
  const status = confidenceToExtractionStatus(raw.confidence);
  if (status === null) return null;

  // A line with no product text can't be matched to an ingredient or sensibly reviewed.
  // (product_name_raw is NOT NULL in Postgres, and "" would pass that check while being
  // useless — so we treat blank as disregarded rather than storing a ghost row.)
  const productName = raw.product_name_raw.trim();
  if (productName === "") return null;

  const issues: string[] = [];
  const line: ExtractedLine = { ...raw, product_name_raw: productName };

  // pack_count → Postgres `integer`. THE INV-04 BUG. A fractional value here is almost
  // always a catch weight that wandered into the wrong field, so we null it rather than
  // rounding: rounding 2.84 to 3 would invent a pack size, and inventing a number is
  // exactly what this app must never do.
  if (line.pack_count !== null && !Number.isInteger(line.pack_count)) {
    issues.push(`pack count "${raw.pack_count}" isn't a whole number`);
    line.pack_count = null;
  }

  // Everything else is a Postgres `numeric` — it just has to be a real, finite number.
  const numericFields: [keyof ExtractedLine, string][] = [
    ["qty_ordered", "quantity ordered"],
    ["unit_weight_min", "minimum unit weight"],
    ["unit_weight_max", "maximum unit weight"],
    ["unit_price", "unit price"],
    ["total_price", "total price"],
  ];
  for (const [field, label] of numericFields) {
    const value = line[field] as number | null;
    if (value !== null && !isStorableNumber(value)) {
      issues.push(`${label} "${value}" isn't a usable number`);
      (line[field] as number | null) = null;
    }
  }

  return {
    line,
    // Any repair we had to make means a human should look at it.
    extractionStatus: issues.length > 0 ? "low_confidence" : status,
    issues,
  };
}

/** The shape we insert into `invoice_lines`. Kept loose on purpose — Supabase types it. */
export interface InvoiceLineRow {
  venue_id: string;
  document_id: string;
  supplier_id: string | null;
  line_no: number;
  product_name_raw: string;
  pack_count: number | null;
  qty_ordered: number | null;
  unit_weight_min: number | null;
  unit_weight_max: number | null;
  unit: ExtractedLine["unit"];
  unit_price: number | null;
  total_price: number | null;
  price_basis: ExtractedLine["price_basis"];
  status_note: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  extraction_status: "extracted" | "low_confidence";
  /** Set by the pipeline when a known alias matches (design doc §3 step 2). */
  ingredient_id: string | null;
  match_confidence: "unmatched" | "high";
}

export interface BuildRowsResult {
  rows: InvoiceLineRow[];
  /** Lines we deliberately didn't store — unreadable or nameless. Shown, not hidden. */
  linesDisregarded: number;
}

/**
 * Validate every line of an invoice and build the rows to insert.
 *
 * One bad line costs you that line and nothing else — which is the entire fix.
 */
export function buildInvoiceLineRows(
  invoice: ExtractedInvoice,
  ctx: { venueId: string; documentId: string; supplierId?: string | null }
): BuildRowsResult {
  const rows: InvoiceLineRow[] = [];
  let linesDisregarded = 0;

  for (const [index, rawLine] of invoice.lines.entries()) {
    const checked = validateExtractedLine(rawLine);
    if (checked === null) {
      linesDisregarded += 1; // counted honestly, never guessed at
      continue;
    }

    const { line, extractionStatus, issues } = checked;

    // The supplier's own label (e.g. "SHORT") plus anything we had to repair, so the
    // review screen can explain a blank field instead of just showing a blank field.
    const notes = [line.status_note?.trim() || null, ...issues].filter(Boolean);

    rows.push({
      venue_id: ctx.venueId,
      document_id: ctx.documentId,
      // Every line carries the supplier too, so price comparisons can query lines
      // directly without joining back through documents.
      supplier_id: ctx.supplierId ?? null,
      // Position on the PAPER invoice, counted before disregarding anything. So if line
      // 2 was unreadable, the saved lines are 1, 3, 4 — the gap shows where it was.
      line_no: index + 1,
      product_name_raw: line.product_name_raw,
      pack_count: line.pack_count,
      qty_ordered: line.qty_ordered,
      unit_weight_min: line.unit_weight_min,
      unit_weight_max: line.unit_weight_max,
      unit: line.unit,
      unit_price: line.unit_price,
      total_price: line.total_price,
      price_basis: line.price_basis,
      status_note: notes.length > 0 ? notes.join(" · ") : null,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      extraction_status: extractionStatus,
      // NOT matched to an ingredient and NOT finalised — the alias-matching slice
      // (design doc §3) and the review/confirm UI come next. Every line starts life as
      // "unmatched", waiting for a human. Principle #2 made concrete.
      ingredient_id: null,
      match_confidence: "unmatched",
      // is_estimated defaults true in the schema; costing recalculates it later.
    });
  }

  return { rows, linesDisregarded };
}
