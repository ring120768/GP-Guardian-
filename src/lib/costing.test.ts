// Tests for the pure costing/GP maths in costing.ts.
// Run with: npm test
// Every number here is worked out by hand in the comment next to it, so if a test
// fails you can check the kitchen maths on paper.

import { describe, it, expect } from "vitest";
import {
  resolvePackWeight,
  costRecipeLine,
  costRecipe,
  netPrice,
  gpPercent,
  recommendedMenuPrice,
  calculateCostMultiple,
  type IngredientCost,
} from "./costing";
import type { RecipeLine, SupplierProduct } from "@/types/database";

function line(overrides: Partial<RecipeLine>): RecipeLine {
  return {
    id: "line-1", venue_id: "v1", recipe_id: "r1", ingredient_id: "butter",
    raw_text: "butter", quantity: 100, unit: "g", waste_percentage: 0,
    match_confidence: "confirmed", ...overrides,
  } as RecipeLine;
}

function product(overrides: Partial<SupplierProduct>): SupplierProduct {
  return {
    observation_count: 0, observed_avg_weight: null,
    unit_weight_min: null, unit_weight_max: null, ...overrides,
  } as SupplierProduct;
}

const food = (costPerUnit: number | null, yieldPercent = 100): IngredientCost => ({
  costPerUnit, yieldPercent, kind: "food",
});

// Butter at £8/kg = £0.008 per gram. Chicken at £2.50 each.
// Salmon at £0.02/g with 80% yield (in-house filleting). Bones: a by-product.
// Blue roll: non-food, which should never be in a recipe.
const prices = new Map<string, IngredientCost>([
  ["butter", food(0.008)],
  ["chicken", food(2.5)],
  ["salmon", food(0.02, 80)],
  ["bones", { costPerUnit: null, yieldPercent: 100, kind: "by_product" }],
  ["blue-roll", { costPerUnit: 0.5, yieldPercent: 100, kind: "non_food" }],
  ["unpriced", food(null)],
]);

describe("resolvePackWeight", () => {
  it("new product: 150-175g supreme → 162.5g midpoint, estimated", () => {
    expect(resolvePackWeight(product({ unit_weight_min: 150, unit_weight_max: 175 })))
      .toEqual({ weight: 162.5, isEstimated: true });
  });
  it("switches to observed average once seen 3+ times", () => {
    const p = product({ unit_weight_min: 150, unit_weight_max: 175, observation_count: 3, observed_avg_weight: 168 });
    expect(resolvePackWeight(p)).toEqual({ weight: 168, isEstimated: false });
  });
  it("still uses the range with only 2 observations", () => {
    const p = product({ unit_weight_min: 150, unit_weight_max: 175, observation_count: 2, observed_avg_weight: 168 });
    expect(resolvePackWeight(p).weight).toBe(162.5);
  });
  it("returns null rather than guessing when there's no weight info", () => {
    expect(resolvePackWeight(product({}))).toEqual({ weight: null, isEstimated: true });
  });
});

describe("costRecipeLine", () => {
  it("100g butter at £8/kg = £0.80", () => {
    expect(costRecipeLine(line({}), prices).line_cost).toBeCloseTo(0.8);
  });
  it("100g salmon at 80% yield → you paid for 125g = £2.50", () => {
    // 100 ÷ 0.8 = 125g × £0.02 = £2.50
    expect(costRecipeLine(line({ ingredient_id: "salmon" }), prices).line_cost).toBeCloseTo(2.5);
  });
  it("ignores the deprecated waste_percentage (waste is now the venue allowance)", () => {
    expect(costRecipeLine(line({ waste_percentage: 10 }), prices).line_cost).toBeCloseTo(0.8);
  });
  it("by-product costs £0, even with no price — the parent cut carries it", () => {
    expect(costRecipeLine(line({ ingredient_id: "bones" }), prices)).toMatchObject({ line_cost: 0, matched: true });
  });
  it("non-food in a recipe → not costed, flagged so it gets fixed", () => {
    expect(costRecipeLine(line({ ingredient_id: "blue-roll" }), prices)).toMatchObject({ line_cost: null, matched: false, problem: "non_food" });
  });
  it("unmatched ingredient → null, never a guess", () => {
    expect(costRecipeLine(line({ ingredient_id: null }), prices)).toMatchObject({ line_cost: null, matched: false, problem: "unmatched" });
  });
  it("matched but no price yet → null", () => {
    expect(costRecipeLine(line({ ingredient_id: "saffron" }), prices)).toMatchObject({ line_cost: null, matched: false, problem: "no_price" });
    expect(costRecipeLine(line({ ingredient_id: "unpriced" }), prices)).toMatchObject({ line_cost: null, problem: "no_price" });
  });
});

describe("costRecipe", () => {
  it("4 supremes + 250g butter, 4 portions → £12 total, £3 a portion", () => {
    const lines = [
      line({ id: "a", ingredient_id: "chicken", quantity: 4, unit: "unit" }),
      line({ id: "b", ingredient_id: "butter", quantity: 250 }),
    ];
    const r = costRecipe(lines, prices, 4);
    expect(r.totalCost).toBeCloseTo(12);
    expect(r.costPerPortion).toBeCloseTo(3);
    expect(r.isIncomplete).toBe(false);
  });
  it("one missing price → whole recipe incomplete, names the line", () => {
    const r = costRecipe([line({ id: "a" }), line({ id: "b", ingredient_id: "saffron" })], prices, 4);
    expect(r).toEqual({ totalCost: null, costPerPortion: null, isIncomplete: true, missingIngredientLineIds: ["b"] });
  });
  it("zero portions → null, no divide by zero", () => {
    expect(costRecipe([line({})], prices, 0).costPerPortion).toBeNull();
  });
});

describe("GP maths (menu prices inc. VAT, GP on net, flat waste allowance)", () => {
  it("£18 menu price at 20% VAT → £15 net", () => { expect(netPrice(18, 20)).toBeCloseTo(15); });
  it("£4.50 cost, £18, 20% VAT, 4% waste → 66.0% GP", () => {
    // net £15 → (15 − 4.50 − 0.60) ÷ 15 = 66%
    expect(gpPercent(4.5, 18, 20, 4)).toBeCloseTo(66.0);
  });
  // The original hand-worked numbers still hold with VAT and waste switched off.
  it("£3 cost, £10 price, no VAT/waste → 70% GP", () => { expect(gpPercent(3, 10, 0, 0)).toBeCloseTo(70); });
  it("zero selling price → null", () => { expect(gpPercent(3, 0, 20, 4)).toBeNull(); });
  it("£3 cost at 70% target, no VAT/waste → £10 recommended", () => { expect(recommendedMenuPrice(3, 70, 0, 0)).toBeCloseTo(10); });
  it("£4.50 cost at 66% target, 20% VAT, 4% waste → £18 recommended", () => {
    // net needed = 4.50 ÷ (1 − 0.66 − 0.04) = £15 → × 1.2 = £18
    expect(recommendedMenuPrice(4.5, 66, 20, 4)).toBeCloseTo(18);
  });
  it("target + waste ≥ 100% → null (no price can get there)", () => {
    expect(recommendedMenuPrice(3, 100, 0, 0)).toBeNull();
    expect(recommendedMenuPrice(3, 96, 20, 4)).toBeNull();
  });
  it("£3 cost, £10 price → 3.33x multiple", () => { expect(calculateCostMultiple(3, 10)).toBeCloseTo(3.333, 2); });
  it("recommended price gives back exactly the target GP", () => {
    const price = recommendedMenuPrice(4.27, 68, 20, 4)!;
    expect(gpPercent(4.27, price, 20, 4)).toBeCloseTo(68, 10);
  });
});
