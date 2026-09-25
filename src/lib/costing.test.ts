// Tests for the pure costing/GP maths in costing.ts.
// Run with: npm test
// Every number here is worked out by hand in the comment next to it, so if a test
// fails you can check the kitchen maths on paper.

import { describe, it, expect } from "vitest";
import {
  resolvePackWeight,
  costRecipeLine,
  costRecipe,
  calculateGpPercent,
  calculateRecommendedPrice,
  calculateCostMultiple,
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

// Butter at £8/kg = £0.008 per gram. Chicken at £2.50 each.
const prices = new Map<string, number>([["butter", 0.008], ["chicken", 2.5]]);

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
  it("100g with 10% waste costs 110g worth = £0.88", () => {
    expect(costRecipeLine(line({ waste_percentage: 10 }), prices).line_cost).toBeCloseTo(0.88);
  });
  it("unmatched ingredient → null, never a guess", () => {
    expect(costRecipeLine(line({ ingredient_id: null }), prices)).toMatchObject({ line_cost: null, matched: false });
  });
  it("matched but no price yet → null", () => {
    expect(costRecipeLine(line({ ingredient_id: "saffron" }), prices)).toMatchObject({ line_cost: null, matched: false });
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

describe("GP maths", () => {
  it("£3 cost, £10 price → 70% GP", () => { expect(calculateGpPercent(3, 10)).toBeCloseTo(70); });
  it("zero selling price → null", () => { expect(calculateGpPercent(3, 0)).toBeNull(); });
  it("£3 cost at 70% target → £10 recommended", () => { expect(calculateRecommendedPrice(3, 70)).toBeCloseTo(10); });
  it("100% target → null", () => { expect(calculateRecommendedPrice(3, 100)).toBeNull(); });
  it("£3 cost, £10 price → 3.33x multiple", () => { expect(calculateCostMultiple(3, 10)).toBeCloseTo(3.333, 2); });
  it("recommended price gives back exactly the target GP", () => {
    const price = calculateRecommendedPrice(4.27, 68)!;
    expect(calculateGpPercent(4.27, price)).toBeCloseTo(68);
  });
});
