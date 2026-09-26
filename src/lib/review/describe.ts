// One invoice line as one readable sentence, the way it looks on the paper invoice:
//
//   "CHIX SUPREME SKIN-ON 150-175G · 2 × (10 × 150–175g) @ £17.90/pack = £35.80"
//   "PORK BELLY BONELESS · 3.61kg @ £8.45/kg = £30.50"
//
// The review screen shows this instead of a row of input boxes, so checking a line
// against the paper is a glance, not a squint.
//
// NEVER INVENT A NUMBER: anything missing prints as "?". A sentence with a "?" in it is
// the chef's cue to open Edit — much better than a plausible-looking guess they'd skim past.
//
// Pure, so it's unit tested (describe.test.ts).

import type { InvoiceLine, PackUnit } from "@/types/database";
import { formatGBP } from "@/lib/format";

export type DescribeLine = Pick<
  InvoiceLine,
  | "product_name_raw"
  | "qty_ordered"
  | "pack_count"
  | "unit_weight_min"
  | "unit_weight_max"
  | "unit"
  | "price_basis"
  | "unit_price"
  | "total_price"
>;

const UNIT_SUFFIX: Record<PackUnit, string> = { g: "g", kg: "kg", ml: "ml", l: "l", unit: " each" };

const num = (n: number | null) => (n === null ? "?" : String(n));
const money = (n: number | null) => (n === null ? "?" : formatGBP(n));

/** "5kg", "150–175g", "?–175g", or null when no weight was printed at all. */
function weightText(line: DescribeLine): string | null {
  const { unit_weight_min: min, unit_weight_max: max } = line;
  if (min === null && max === null) return null;
  const amount = min === max ? num(min) : `${num(min)}–${num(max)}`;
  return `${amount}${UNIT_SUFFIX[line.unit]}`;
}

/** "10 × 150–175g", "5kg", "12 × ?" (count known, weight not), or null if neither printed. */
function packText(line: DescribeLine): string | null {
  const weight = weightText(line);
  if (line.pack_count !== null && line.pack_count > 1)
    return `${line.pack_count} × ${weight ?? "?"}`;
  return weight;
}

export function describeLine(line: DescribeLine): string {
  const total = `= ${money(line.total_price)}`;
  let middle: string;

  switch (line.price_basis) {
    case "per_kg":
    case "per_litre": {
      // Catch weight: the delivered weight IS the quantity. Same sign rule as
      // lineMathCheck — a negative qty means a credit, so the weight prints negative.
      const per = line.price_basis === "per_kg" ? "kg" : "litre";
      const weight = weightText(line) ?? "?";
      const sign = line.qty_ordered !== null && line.qty_ordered < 0 ? "-" : "";
      middle = `${sign}${weight} @ ${money(line.unit_price)}/${per}`;
      break;
    }
    case "per_unit":
      middle = `${num(line.qty_ordered)} @ ${money(line.unit_price)} each`;
      break;
    default: {
      // per_pack, or null (the invoice didn't say what the price is per → "/?").
      const pack = packText(line);
      // Brackets only when the pack itself has a "×" in it: "2 × (10 × 150g)" reads
      // clearly, "2 × (5kg)" is just noise.
      const packPart = pack === null ? "" : pack.includes("×") ? ` × (${pack})` : ` × ${pack}`;
      const per = line.price_basis === "per_pack" ? "/pack" : "/?";
      middle = `${num(line.qty_ordered)}${packPart} @ ${money(line.unit_price)}${per}`;
    }
  }

  return `${line.product_name_raw} · ${middle} ${total}`;
}
