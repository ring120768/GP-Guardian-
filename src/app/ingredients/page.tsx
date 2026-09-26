// Ingredients — everything the venue buys, what it costs now, and its yield.
//
// "Latest price" is worked out from the newest matched invoice line by
// latestPricePerUnit(): per kg, per litre or each, so different pack sizes compare.
// If it can't be worked out, it says why instead of guessing.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { latestPricePerUnit, type PerUnitLine } from "@/lib/prices/perUnit";
import { formatGBP } from "@/lib/format";
import { YieldInput } from "@/components/YieldInput";
import type { Ingredient, IngredientKind } from "@/types/database";

const KIND_LABELS: Record<IngredientKind, string> = {
  food: "Food",
  non_food: "Not food",
  by_product: "By-product",
};
const UNIT_LABELS: Record<Ingredient["default_unit"], string> = { g: "g", ml: "ml", unit: "each" };

type MatchedLine = PerUnitLine & { ingredient_id: string };

export default async function IngredientsPage() {
  const supabase = createClient();

  const [ingredientsRes, linesRes] = await Promise.all([
    supabase
      .from("ingredients")
      .select("*")
      .eq("active", true)
      .order("canonical_name")
      .returns<Ingredient[]>(),
    // Every matched line, newest invoice first, so each ingredient's first line is its latest.
    supabase
      .from("invoice_lines")
      .select(
        "ingredient_id, price_basis, qty_ordered, pack_count, unit_weight_min, unit_weight_max, unit, unit_price, total_price"
      )
      .not("ingredient_id", "is", null)
      .order("invoice_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .returns<MatchedLine[]>(),
  ]);

  const failed = ingredientsRes.error ?? linesRes.error;
  if (failed) throw new Error(`Couldn't load ingredients: ${failed.message}`);

  const linesByIngredient = new Map<string, MatchedLine[]>();
  for (const line of linesRes.data ?? []) {
    linesByIngredient.set(line.ingredient_id, [
      ...(linesByIngredient.get(line.ingredient_id) ?? []),
      line,
    ]);
  }

  const ingredients = ingredientsRes.data ?? [];

  return (
    <div className="min-h-screen p-8">
      <header className="mb-6 max-w-4xl">
        <h1 className="text-2xl font-semibold">Ingredients</h1>
        <p className="text-sm text-neutral-500">
          Latest prices come from matched invoice lines. Yield is only for things you butcher or
          fillet yourself — leave it at 100% otherwise.
        </p>
      </header>

      {ingredients.length === 0 ? (
        <p className="max-w-4xl rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
          No ingredients yet. They&apos;re created as you{" "}
          <Link href="/ingredients/match" className="underline">
            match invoice lines
          </Link>
          .
        </p>
      ) : (
        <div className="max-w-4xl overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Ingredient</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Measured in</th>
                <th className="px-4 py-2 font-medium">Yield</th>
                <th className="px-4 py-2 font-medium">Latest price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {ingredients.map((ing) => {
                const price = latestPricePerUnit(linesByIngredient.get(ing.id) ?? []);
                return (
                  <tr key={ing.id} className="align-top">
                    <td className="px-4 py-2 font-medium">{ing.canonical_name}</td>
                    <td className="px-4 py-2 text-neutral-600">{KIND_LABELS[ing.kind]}</td>
                    <td className="px-4 py-2 text-neutral-600">{UNIT_LABELS[ing.default_unit]}</td>
                    <td className="px-4 py-2">
                      <YieldInput ingredientId={ing.id} initial={ing.yield_percent} />
                    </td>
                    <td className="px-4 py-2">
                      {price.ok ? (
                        // "≈" when a weight RANGE was averaged (design doc §4) — honest
                        // that it's an estimate, not an exact figure.
                        <span title={price.estimated ? "Estimated from a weight range" : undefined}>
                          {price.estimated && "≈ "}
                          {formatGBP(price.price)} / {price.per}
                        </span>
                      ) : (
                        <>
                          <span className="text-neutral-400">—</span>
                          <span className="block text-xs text-neutral-500">{price.note}</span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
