// Tests for the ingredient matcher. Run with: npm test

import { describe, it, expect } from "vitest";
import { normaliseForMatch, findExactAlias, suggestMatches } from "./match";

describe("normaliseForMatch", () => {
  it("strips pack/weight/size tokens and lower-cases", () => {
    expect(normaliseForMatch("CHIX SUPREME SKIN-ON 150-175G")).toBe("chix supreme skin-on");
    expect(normaliseForMatch("BEEF MINCE 15% FAT 5KG")).toBe("beef mince 15% fat");
    expect(normaliseForMatch("BUTTER 10x250g")).toBe("butter");
    expect(normaliseForMatch("BLUE ROLL 2PLY x6")).toBe("blue roll");
    expect(normaliseForMatch("KING PRAWNS 16/20 RAW")).toBe("king prawns raw");
    expect(normaliseForMatch("RAPESEED OIL 20L")).toBe("rapeseed oil");
    expect(normaliseForMatch("CHICKEN 5x1kg")).toBe("chicken");
  });

  it("collapses spaces and drops stray separators", () => {
    expect(normaliseForMatch("  PORK   BELLY - 5KG ")).toBe("pork belly");
  });

  it("keeps bare numbers that are part of the product", () => {
    expect(normaliseForMatch("CHINESE 5 SPICE 500G")).toBe("chinese 5 spice");
  });
});

const INGREDIENTS = [
  { id: "chicken", canonical_name: "Chicken supreme" },
  { id: "thigh", canonical_name: "Chicken thigh" },
  { id: "mince", canonical_name: "Beef mince" },
  { id: "butter", canonical_name: "Butter" },
];

describe("findExactAlias", () => {
  const aliases = [
    { ingredient_id: "chicken", raw_text: "chix supreme skin-on", supplier_id: "S1" },
    { ingredient_id: "mince", raw_text: "mince", supplier_id: null },
    { ingredient_id: "thigh", raw_text: "mince", supplier_id: "S2" }, // odd, but supplier-specific wins
  ];

  it("matches on normalised text, whatever the pack size this week", () => {
    expect(findExactAlias("CHIX SUPREME SKIN-ON 180-200G", aliases, "S1")).toBe("chicken");
  });
  it("doesn't use another supplier's alias", () => {
    expect(findExactAlias("CHIX SUPREME SKIN-ON 150-175G", aliases, "S9")).toBeNull();
  });
  it("prefers the supplier's own alias over a supplier-less one", () => {
    expect(findExactAlias("MINCE 5KG", aliases, "S2")).toBe("thigh");
    expect(findExactAlias("MINCE 5KG", aliases, "S1")).toBe("mince");
  });
});

describe("suggestMatches", () => {
  it("exact alias → one 'high' suggestion", () => {
    const aliases = [
      { ingredient_id: "chicken", raw_text: "chix supreme skin-on", supplier_id: "S1" },
    ];
    expect(suggestMatches("CHIX SUPREME SKIN-ON 150-175G", INGREDIENTS, aliases, "S1")).toEqual([
      { ingredientId: "chicken", name: "Chicken supreme", score: 1, confidence: "high" },
    ]);
  });

  it("otherwise ranks by word overlap, top 3, best first", () => {
    const s = suggestMatches("CHICKEN SUPREME 150-175G", INGREDIENTS, []);
    expect(s[0]).toMatchObject({ ingredientId: "chicken", confidence: "medium" });
    expect(s[0].score).toBe(1);
    expect(s.map((x) => x.ingredientId)).toEqual(["chicken", "thigh"]);
  });

  it("uses aliases' text too, not just ingredient names", () => {
    const aliases = [{ ingredient_id: "butter", raw_text: "unsalted block", supplier_id: "S1" }];
    const s = suggestMatches("UNSALTED BLOCK 250G", INGREDIENTS, aliases, "S2");
    expect(s[0].ingredientId).toBe("butter");
  });

  it("returns nothing when no words overlap — no random guesses", () => {
    expect(suggestMatches("SAFFRON 1G", INGREDIENTS, [])).toEqual([]);
  });
});
