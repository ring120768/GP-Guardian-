// The single "Weight" box on the review screen, standing in for two database columns:
//
//   "5"        → unit_weight_min 5,   unit_weight_max 5     (a fixed weight)
//   "150-175"  → unit_weight_min 150, unit_weight_max 175   (a range, e.g. chicken breasts)
//   ""         → both null                                  (no weight printed)
//
// One box because that's how the invoice prints it ("150-175G"). Two boxes made the chef
// type the same number twice for every fixed-weight product.
//
// Pure, so it's unit tested (weight.test.ts).

export type WeightParse =
  { ok: true; min: number | null; max: number | null } | { ok: false; error: string };

// A plain positive number: "5", "0.5", "3.61". No signs, no units — the unit has its own box.
const NUMBER = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const SINGLE = new RegExp(`^${NUMBER}$`);
// Hyphen or en dash, spaces optional: "150-175", "150 – 175".
const RANGE = new RegExp(`^${NUMBER}\\s*[-–]\\s*${NUMBER}$`);

export function parseWeight(text: string): WeightParse {
  const t = text.trim();
  if (t === "") return { ok: true, min: null, max: null }; // blank = not printed, never 0

  const single = t.match(SINGLE);
  if (single) {
    const n = Number(single[1]);
    return { ok: true, min: n, max: n };
  }

  const range = t.match(RANGE);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min > max) return { ok: false, error: `Weight range "${t}" is backwards — smallest first` };
    return { ok: true, min, max };
  }

  return { ok: false, error: `Weight "${t}" should be a number like 5, or a range like 150-175` };
}

/** The reverse, for filling the box from the database: 5/5 → "5", 150/175 → "150-175". */
export function formatWeightInput(min: number | null, max: number | null): string {
  if (min === null && max === null) return "";
  if (min === null || max === null || min === max) return String(min ?? max);
  return `${min}-${max}`;
}
