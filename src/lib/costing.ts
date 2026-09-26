// Costing & GP math — matches gp-guardian-ingredient-matching-design.md Part B §10-11, Part C.
// Kept as pure functions with no DB access so they're easy to test in isolation.

import type { IngredientKind, RecipeLine, SupplierProduct } from "@/types/database";

/**
 * What costing needs to know about one ingredient.
 *   costPerUnit  → £ per canonical unit (per g / ml / unit). Null = no price yet.
 *   yieldPercent → 1–100; 100 = off (see CLAUDE.md "Money rules").
 *   kind         → by_product costs £0; non_food must never be in a recipe.
 */
export interface IngredientCost {
  costPerUnit: number | null;
  yieldPercent: number;
  kind: IngredientKind;
}

/** Why a line couldn't be costed — so the UI can say what's missing, not just "incomplete". */
export type LineCostProblem = "unmatched" | "no_price" | "non_food";

export interface LineCostResult {
  recipe_line_id: string;
  line_cost: number | null; // null if it can't be costed — never a guess
  matched: boolean;
  problem: LineCostProblem | null;
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
 * Part B §10 — cost a single recipe line, using the ingredient's yield.
 *
 *   line cost = quantity ÷ (yield / 100) × price per unit
 *
 * 100g of usable fillet at 80% yield means you bought 125g, so you pay for 125g.
 *
 * recipe_lines.waste_percentage is DEPRECATED and deliberately ignored: everyday waste
 * is now the venue's flat allowance in gpPercent(), and prep loss is the ingredient's
 * yield. Applying both would double-count it.
 *
 * Returns null (not a guess) if the ingredient is unmatched, has no price yet, or is
 * non-food — a non-food item in a recipe is a mistake to fix, not something to quietly
 * skip, so the recipe shows as incomplete and names the line.
 */
export function costRecipeLine(
  line: RecipeLine,
  costs: Map<string, IngredientCost> // ingredient_id → cost info
): LineCostResult {
  const fail = (problem: LineCostProblem): LineCostResult => ({
    recipe_line_id: line.id,
    line_cost: null,
    matched: false,
    problem,
  });

  if (!line.ingredient_id) return fail("unmatched");
  const ingredient = costs.get(line.ingredient_id);
  if (!ingredient) return fail("no_price");
  if (ingredient.kind === "non_food") return fail("non_food");

  // Trim/bones: £0, so the parent cut carries the whole cost. No price needed.
  if (ingredient.kind === "by_product") {
    return { recipe_line_id: line.id, line_cost: 0, matched: true, problem: null };
  }
  if (ingredient.costPerUnit === null) return fail("no_price");

  const paidForQuantity = line.quantity / (ingredient.yieldPercent / 100);
  return {
    recipe_line_id: line.id,
    line_cost: paidForQuantity * ingredient.costPerUnit,
    matched: true,
    problem: null,
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
  costs: Map<string, IngredientCost>,
  portions: number
): RecipeCostResult {
  const results = lines.map((line) => costRecipeLine(line, costs));
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

// ─────────────────────────────────────────────────────────────────────────────
// GP — the agreed money rules (CLAUDE.md "Money rules"):
//   • Menu prices INCLUDE VAT. GP is always on the NET price.
//   • A flat waste allowance (% of net) comes off GP.
// Percentages are passed as whole numbers: 20 means 20%.
// ─────────────────────────────────────────────────────────────────────────────

/** Menu price without VAT. £18 at 20% → £15. */
export function netPrice(menuPrice: number, vatRate: number): number {
  return menuPrice / (1 + vatRate / 100);
}

/**
 * GP% on the net price, after the waste allowance.
 *
 *   GP% = (net − cost − net × waste%) ÷ net × 100
 *
 * £4.50 cost, £18 menu price, 20% VAT, 4% waste:
 *   net £15 → (15 − 4.50 − 0.60) ÷ 15 = 66.0%
 *
 * Null for a zero/negative price — there's no GP to speak of, and dividing by it is nonsense.
 */
export function gpPercent(
  cost: number,
  menuPrice: number,
  vatRate: number,
  wastePct: number
): number | null {
  if (menuPrice <= 0) return null;
  const net = netPrice(menuPrice, vatRate);
  return ((net - cost - net * (wastePct / 100)) / net) * 100;
}

/**
 * Part C §14 — the menu price (inc. VAT) that hits the target GP. A SUGGESTION only —
 * never written to selling_price (non-negotiable #3).
 *
 *   net needed = cost ÷ (1 − target% − waste%)     ← rearranged from gpPercent()
 *   menu price = net needed × (1 + VAT%)
 *
 * Null when target% + waste% ≥ 100: no price can get there (it'd need a negative cost).
 * Round-trips: gpPercent(cost, recommendedMenuPrice(cost, t, v, w), v, w) === t.
 */
export function recommendedMenuPrice(
  cost: number,
  targetGp: number,
  vatRate: number,
  wastePct: number
): number | null {
  if (targetGp + wastePct >= 100) return null;
  const net = cost / (1 - targetGp / 100 - wastePct / 100);
  return net * (1 + vatRate / 100);
}

/**
 * Part C §15 — secondary read-out for chefs who think in cost multiples, not GP%.
 */
export function calculateCostMultiple(costPerPortion: number, sellingPrice: number): number | null {
  if (costPerPortion <= 0) return null;
  return sellingPrice / costPerPortion;
}
