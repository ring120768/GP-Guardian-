// Price-change detection: has this product gone up since the last invoice?
//
// Pure — no Supabase, no network — so it's unit tested (compare.test.ts). The documents
// page loads the lines and calls this; the card just displays the results.
//
// WHAT COUNTS AS "THE SAME PRODUCT"
//
// All four have to agree, or the comparison is meaningless:
//   • same supplier       — Browns' mince vs Smiths' mince isn't a price rise
//   • same product name   — normalised: trimmed, spaces collapsed, upper-cased
//   • same price_basis    — £7.95 per kg vs £38.75 per pack isn't a 387% rise
//   • same unit
//
// "PREVIOUS" = the most recent line for that product from the same supplier on an
// invoice with an EARLIER invoice_date. Strictly earlier, so a product can never be
// compared with itself or with another invoice from the same day.
//
// Never guess on money (design principle #1): if a line can't be compared honestly it
// comes back 'skipped' or 'new', with no percentage — never a made-up one.

import type { InvoiceLine } from "@/types/database";

/** A rise above this % is red; any smaller rise is amber. Drops are green. */
export const ALERT_THRESHOLD_PCT = 10;

/** The columns comparePrices needs — a subset of InvoiceLine, so tests stay short. */
export type PriceLine = Pick<
  InvoiceLine,
  | "supplier_id"
  | "product_name_raw"
  | "price_basis"
  | "unit"
  | "pack_count"
  | "unit_weight_min"
  | "unit_weight_max"
  | "unit_price"
  | "total_price"
  | "extraction_status"
  | "invoice_number"
  | "invoice_date"
>;

export type PriceStatus = "up" | "down" | "same" | "new" | "pack_changed" | "skipped";

export interface PriceComparison {
  status: PriceStatus;
  productName: string;
  previousPrice: number | null;
  currentPrice: number | null;
  /** Only set for up/down/same. Null whenever a % would be misleading. */
  changePct: number | null;
  previousInvoiceNumber: string | null;
  previousDate: string | null;
}

/** "  beef  mince 15%  fat " → "BEEF MINCE 15% FAT". Suppliers aren't consistent about spacing or case. */
export function normaliseProductName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Lines we won't compare, as either the current OR the previous side:
 *   • no unit price     — nothing to compare
 *   • negative total    — a credit/return, not a purchase price
 *   • 'unreadable'      — the AI said it couldn't read it
 */
export function isUncomparable(line: PriceLine): boolean {
  return (
    line.unit_price === null ||
    (line.total_price !== null && line.total_price < 0) ||
    line.extraction_status === "unreadable"
  );
}

function sameProduct(a: PriceLine, b: PriceLine): boolean {
  return (
    a.supplier_id === b.supplier_id &&
    a.price_basis === b.price_basis &&
    a.unit === b.unit &&
    normaliseProductName(a.product_name_raw) === normaliseProductName(b.product_name_raw)
  );
}

/**
 * A per-pack price only compares like-for-like if the pack is the same. £38.75 for 5kg
 * → £44.95 for 6kg isn't a 16% rise; it's a different product. Per-kg/litre/unit prices
 * already account for size, so the pack doesn't matter for them.
 */
function packChanged(a: PriceLine, b: PriceLine): boolean {
  if (a.price_basis !== "per_pack") return false;
  return (
    a.pack_count !== b.pack_count ||
    a.unit_weight_min !== b.unit_weight_min ||
    a.unit_weight_max !== b.unit_weight_max
  );
}

/** Compare in whole pence so float noise (0.1 + 0.2) never shows up as a "change". */
const pence = (x: number) => Math.round(x * 100);

/**
 * One result per current line, in the same order.
 *
 * `previousLines` can be every line the venue has ever had (current ones included) —
 * the "same supplier + strictly earlier date" rule does the filtering.
 */
export function comparePrices(
  currentLines: PriceLine[],
  previousLines: PriceLine[]
): PriceComparison[] {
  return currentLines.map((line) => {
    const base: PriceComparison = {
      status: "skipped",
      productName: line.product_name_raw,
      previousPrice: null,
      currentPrice: line.unit_price,
      changePct: null,
      previousInvoiceNumber: null,
      previousDate: null,
    };

    if (isUncomparable(line)) return base;

    // No supplier or no date → we can't say which invoice came "before". Treat it as
    // having no history rather than guessing at one.
    if (line.supplier_id === null || line.invoice_date === null) {
      return { ...base, status: "new" };
    }
    const currentDate = line.invoice_date;

    // ISO dates (YYYY-MM-DD) sort correctly as plain strings, so < and > just work.
    let previous: PriceLine | null = null;
    for (const p of previousLines) {
      if (p.invoice_date === null || p.invoice_date >= currentDate) continue;
      if (!sameProduct(line, p) || isUncomparable(p)) continue;
      if (previous === null || p.invoice_date > previous.invoice_date!) previous = p;
    }

    if (previous === null) return { ...base, status: "new" };

    const withPrevious: PriceComparison = {
      ...base,
      previousPrice: previous.unit_price,
      previousInvoiceNumber: previous.invoice_number,
      previousDate: previous.invoice_date,
    };

    if (packChanged(line, previous)) return { ...withPrevious, status: "pack_changed" };

    // Both non-null — isUncomparable() already ruled out nulls on both sides.
    const cur = line.unit_price!;
    const prev = previous.unit_price!;

    if (pence(cur) === pence(prev)) return { ...withPrevious, status: "same", changePct: 0 };

    // A free line last time (£0) has no meaningful % change. Say "new" rather than ∞%.
    if (prev === 0) return { ...base, status: "new" };

    const changePct = ((cur - prev) / prev) * 100;
    return { ...withPrevious, status: cur > prev ? "up" : "down", changePct };
  });
}

/** Colour for the card: red = rise over the threshold, amber = smaller rise, green = drop. */
export function alertColour(result: PriceComparison): "red" | "amber" | "green" | null {
  if (result.status === "down") return "green";
  if (result.status !== "up" || result.changePct === null) return null;
  return result.changePct > ALERT_THRESHOLD_PCT ? "red" : "amber";
}
