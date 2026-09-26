// Ingredient matching — design doc §3. Pure (no DB), unit tested in match.test.ts.
//
// THE LOOP:
//   1. Normalise the invoice's product text: "CHIX SUPREME SKIN-ON 150-175G" →
//      "chix supreme skin-on". Pack sizes and weights change between orders; the
//      product doesn't.
//   2. Exact alias hit (same normalised text, same supplier or a supplier-less alias)
//      → that ingredient, 'high', zero clicks.
//   3. Otherwise suggest up to 3 ingredients by simple word overlap. The chef confirms,
//      and that confirmation is written as an alias → next time, step 2 catches it.
//
// No embeddings/AI yet: word overlap is dumb but predictable, and the alias table does
// the real work — it only has to be right once per product.

import type { Ingredient, IngredientAlias } from "@/types/database";

// Tokens that describe the PACK, not the product. Stripped before matching.
const PACK_TOKENS: RegExp[] = [
  // Count × size written as one word: "10x250g", "5x1kg", "2x6". Must run first — there's
  // no word boundary inside "10x250g", so the separate patterns below can't see it.
  /\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|cl|l|ltr|litre|oz|lb)?\b/g,
  // Weight/volume ranges and sizes: "150-175g", "150–175", "5kg", "1.5l", "330ml", "2x1kg"'s "1kg"
  /\b\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|cl|l|ltr|oz|lb)?\b/g,
  /\b\d+(?:\.\d+)?\s*(?:g|kg|ml|cl|l|ltr|litre|oz|lb)\b/g,
  // Pack counts: "10x", "10 x", "x10"
  /\b\d+\s*x\b/g,
  /\bx\s*\d+\b/g,
  // Paper/tissue ply: "2ply", "2 ply"
  /\b\d+\s*ply\b/g,
  // Size grades: prawns "16/20", eggs "15/30"
  /\b\d+\/\d+\b/g,
];

/**
 * "CHIX SUPREME SKIN-ON 150-175G" → "chix supreme skin-on".
 *
 * Bare numbers are KEPT on purpose: "chinese 5 spice" needs its 5. Only numbers that
 * are clearly pack/size tokens (with a unit, an x, a ply, a slash) go.
 */
export function normaliseForMatch(raw: string): string {
  let s = raw.toLowerCase();
  for (const re of PACK_TOKENS) s = s.replace(re, " ");
  // Stripping can leave stray separators behind ("beef - 5kg" → "beef - ").
  return s
    .replace(/(^|\s)[-–,/]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text we match and store aliases on. Same as normaliseForMatch, except a name that
 * is NOTHING but pack tokens ("5KG") falls back to its plain lower-cased self rather
 * than "" — otherwise every such line would share one blank key.
 *
 * Every step (queue grouping, alias writing, auto-match) uses THIS, so they can't drift.
 */
export function matchText(raw: string): string {
  return normaliseForMatch(raw) || raw.trim().toLowerCase().replace(/\s+/g, " ");
}

type AliasLike = Pick<IngredientAlias, "ingredient_id" | "raw_text" | "supplier_id">;
type IngredientLike = Pick<Ingredient, "id" | "canonical_name">;

/**
 * Step 2: an alias for this exact (normalised) text. A supplier-specific alias wins over
 * a supplier-less one — "MINCE" from the butcher and "MINCE" from the veg man may not be
 * the same thing.
 */
export function findExactAlias(
  raw: string,
  aliases: AliasLike[],
  supplierId: string | null
): string | null {
  const norm = matchText(raw);
  if (norm === "") return null;
  let generic: string | null = null;
  for (const a of aliases) {
    if (matchText(a.raw_text) !== norm) continue;
    if (a.supplier_id !== null && a.supplier_id === supplierId) return a.ingredient_id;
    if (a.supplier_id === null) generic ??= a.ingredient_id;
  }
  return generic;
}

export interface Suggestion {
  ingredientId: string;
  name: string;
  /** 0–1. 1 = exact alias. */
  score: number;
  confidence: "high" | "medium" | "low";
}

/** Word overlap above this is worth pre-selecting for a one-tap confirm. */
const MEDIUM_SCORE = 0.5;

// Split on spaces AND hyphens so "skin-on" and "skin on" share their words.
const tokens = (s: string) =>
  new Set(
    normaliseForMatch(s)
      .split(/[\s-]+/)
      .filter(Boolean)
  );

/** Jaccard overlap: shared words ÷ all distinct words. 1 = same words, 0 = none shared. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Step 2 + 3: an exact alias → one 'high' suggestion. Otherwise up to 3 ingredients by
 * word overlap with their name or any of their aliases. Empty when nothing overlaps —
 * better no suggestion than a random one.
 */
export function suggestMatches(
  raw: string,
  ingredients: IngredientLike[],
  aliases: AliasLike[],
  supplierId: string | null = null
): Suggestion[] {
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const exact = findExactAlias(raw, aliases, supplierId);
  if (exact && byId.has(exact)) {
    return [
      { ingredientId: exact, name: byId.get(exact)!.canonical_name, score: 1, confidence: "high" },
    ];
  }

  const words = tokens(raw);
  const aliasTexts = new Map<string, string[]>();
  for (const a of aliases) {
    aliasTexts.set(a.ingredient_id, [...(aliasTexts.get(a.ingredient_id) ?? []), a.raw_text]);
  }

  return ingredients
    .map((ing) => {
      const texts = [ing.canonical_name, ...(aliasTexts.get(ing.id) ?? [])];
      const score = Math.max(...texts.map((t) => overlap(words, tokens(t))));
      return {
        ingredientId: ing.id,
        name: ing.canonical_name,
        score,
        confidence: score >= MEDIUM_SCORE ? ("medium" as const) : ("low" as const),
      };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);
}
