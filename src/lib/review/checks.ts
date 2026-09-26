// "Does this line add up?" — a quick sum the chef would do in their head, done for them.
//
// Pure (no DB, no React), so the review screen can run it live as the chef types, and
// it's unit tested in checks.test.ts.
//
// WHICH QUANTITY TIMES THE PRICE, depends on what the price is per (price_basis):
//   per_pack / per_unit  → qty_ordered × unit_price       "3 × £9.20 = £27.60"
//   per_kg / per_litre   → unit_weight_min × unit_price   "3.42kg × £7.95 = £27.19"
//                          (a catch-weight line: the delivered weight is printed on it)
//
// NEVER GUESS: if anything we need is missing, the answer is "can't check" (ok: true,
// expectedTotal: null) — NOT "wrong". Flagging every line with a blank qty would train
// the chef to ignore the amber notes, and then they'd miss the real ones.

import type { InvoiceLine } from "@/types/database";
import { formatGBP } from "@/lib/format";

export type MathCheckLine = Pick<
  InvoiceLine,
  "price_basis" | "qty_ordered" | "unit_weight_min" | "unit_price" | "total_price"
>;

export interface MathCheck {
  ok: boolean;
  /** What the total should be. Null when we couldn't check. Not rounded — display does that. */
  expectedTotal: number | null;
  message: string | null;
}

/** Invoices round each line to the penny, so 1p either way is the invoice, not an error. */
const TOLERANCE_PENCE = 1;

const CANT_CHECK: MathCheck = { ok: true, expectedTotal: null, message: null };

export function lineMathCheck(line: MathCheckLine): MathCheck {
  const { price_basis, unit_price, total_price } = line;
  if (price_basis === null || unit_price === null || total_price === null) return CANT_CHECK;

  let quantity: number | null;
  if (price_basis === "per_pack" || price_basis === "per_unit") {
    quantity = line.qty_ordered;
  } else {
    // per_kg / per_litre. The weight is printed positive even on a credit, so take the
    // sign from qty_ordered: "-1 × 3.42kg returned" should expect a NEGATIVE total.
    quantity =
      line.unit_weight_min === null
        ? null
        : line.qty_ordered !== null && line.qty_ordered < 0
          ? -line.unit_weight_min
          : line.unit_weight_min;
  }
  if (quantity === null) return CANT_CHECK;

  const expectedTotal = quantity * unit_price;

  // Compare in whole pence. 3.42 × 7.95 = 27.189 in floating point; the invoice printed
  // £27.19. Rounded to pence, those are both 2719.
  const diff = Math.abs(Math.round(expectedTotal * 100) - Math.round(total_price * 100));
  if (diff <= TOLERANCE_PENCE) return { ok: true, expectedTotal, message: null };

  return {
    ok: false,
    expectedTotal,
    message: `Doesn't add up: ${quantity} × ${formatGBP(unit_price)} = ${formatGBP(
      expectedTotal
    )}, but the line total says ${formatGBP(total_price)}.`,
  };
}
