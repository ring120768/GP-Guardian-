// Display helpers shared by the documents and suppliers screens.

import type { alertColour } from "@/lib/prices/compare";

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/**
 * £1,234.56. This is the ONE place money gets rounded to pennies — the maths upstream
 * keeps full precision so rounding errors can't pile up across hundreds of lines.
 * Null → "—": an unknown amount is shown as unknown, never as £0.00.
 */
export function formatGBP(n: number | null): string {
  return n === null ? "—" : GBP.format(n);
}

/** "+16.0%" / "-4.2%". */
export function formatPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** 2026-09-08 → 08/09/2026. Parsed by hand: new Date("2026-09-08") is UTC midnight,
 *  which can display as the day before in some timezones. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Text colour for a price alert — red rise over threshold, amber smaller rise, green drop. */
export const ALERT_TEXT_CLASSES: Record<NonNullable<ReturnType<typeof alertColour>>, string> = {
  red: "text-red-600",
  amber: "text-amber-600",
  green: "text-green-700",
};
