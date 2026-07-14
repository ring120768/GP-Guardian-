// Costing & GP math — matches gp-guardian-ingredient-matching-design.md Part B §10-11, Part C.
// Kept as pure functions with no DB access so they're easy to test in isolation.

import type { RecipeLine, SupplierProduct } from "@/types/database";

export interface IngredientCostLookup {
  ingredient_id: string;
  cost_per_canonical_unit: number; // £ per gram / ml / unit
}

export interface LineCostResult {
  recipe_line_id: string;
  line_cost: number | null; // null if unmatched or no price yet
  matched: boolean;
}

/**
 * Part A §4 — resolve a supplier product's per-unit weight.
 * Prefers the calibrated observed average once there's enough history;
 * falls back to the midpoint of the extracted weight range.
 */
export function resolvePackWeight(product: SupplierProduct): {
  weight: number | null;
  isEstimated: boolean;
} {
  if (product.observation_count >= 3 && product.observed_avg_weight != null) {
    return { weight: product.observed_avg_weight, isEstimated: false };
  }
  if (product.unit_weight_min != null && product.unit_weight_max != null) {
    return { weight: (product.unit_weight_min + product.unit_weight_max) / 2, isEstimated: true };
  }
  return { weight: null, isEstimated: true };
}

/**
 * Part B §10 — cost a single recipe line given a resolved ingredient cost.
 * Returns null (not a guess) if the ingredient is unmatched or has no price yet.
 */
export function costRecipeLine(
  line: RecipeLine,
  costLookup: Map<string, number> // ingredient_id -> cost per canonical unit
): LineCostResult {
  if (!line.ingredient_id) {
    return { recipe_line_id: line.id, line_cost: null, matched: false };
  }

  const costPerUnit = costLookup.get(line.ingredient_id);
  if (costPerUnit == null) {
    return { recipe_line_id: line.id, line_cost: null, matched: false };
  }

  const effectiveQuantity = line.quantity * (1 + line.waste_percentage / 100);
  return {
    recipe_line_id: line.id,
    line_cost: effectiveQuantity * costPerUnit,
    matched: true,
  };
}

export interface RecipeCostResult {
  totalCost: number | null;
  costPerPortion: number | null;
  isIncomplete: boolean;
  missingIngredientLineIds: string[];
}

/**
 * Part B §10 — cost an entire recipe. Never silently estimates a missing line;
 * flags the recipe as incomplete instead so the UI can say what's missing.
 */
export function costRecipe(
  lines: RecipeLine[],
  costLookup: Map<string, number>,
  portions: number
): RecipeCostResult {
  const results = lines.map((line) => costRecipeLine(line, costLookup));
  const missing = results.filter((r) => !r.matched).map((r) => r.recipe_line_id);

  if (missing.length > 0) {
    return {
      totalCost: null,
      costPerPortion: null,
      isIncomplete: true,
      missingIngredientLineIds: missing,
    };
  }

  const totalCost = results.reduce((sum, r) => sum + (r.line_cost ?? 0), 0);
  const costPerPortion = portions > 0 ? totalCost / portions : null;

  return { totalCost, costPerPortion, isIncomplete: false, missingIngredientLineIds: [] };
}

/**
 * Part C — GP% for a given cost and selling price.
 */
export function calculateGpPercent(costPerPortion: number, sellingPrice: number): number | null {
  if (sellingPrice <= 0) return null;
  return ((sellingPrice - costPerPortion) / sellingPrice) * 100;
}

/**
 * Part C §14 — recommended price is a suggestion only, never auto-applied to selling_price.
 */
export function calculateRecommendedPrice(costPerPortion: number, targetGp: number): number | null {
  if (targetGp >= 100) return null; // avoid divide-by-zero / nonsensical target
  return costPerPortion / (1 - targetGp / 100);
}

/**
 * Part C §15 — secondary read-out for chefs who think in cost multiples, not GP%.
 */
export function calculateCostMultiple(costPerPortion: number, sellingPrice: number): number | null {
  if (costPerPortion <= 0) return null;
  return sellingPrice / costPerPortion;
}
