// Match ingredients — design doc §3 + §5.3.
//
// One row per PRODUCT (supplier + name, whatever the pack size), not per invoice line.
// The chef answers once; the answer is applied to every matching line and saved as an
// alias, so that product auto-matches on every future invoice.
//
// Server component: loads the queue and works out suggestions here, so the browser gets
// a ready-to-answer list. The buttons live in MatchQueue (client).

import { createClient } from "@/lib/supabase/server";
import { loadMatchQueue } from "@/lib/matching/loadQueue";
import { suggestMatches } from "@/lib/matching/match";
import { MatchQueue, type MatchRowData } from "@/components/MatchQueue";
import { formatGBP } from "@/lib/format";
import type { Ingredient, IngredientAlias, PriceBasis, Supplier } from "@/types/database";

const BASIS_SUFFIX: Record<PriceBasis, string> = {
  per_pack: "/pack",
  per_kg: "/kg",
  per_litre: "/L",
  per_unit: " each",
};

export default async function MatchIngredientsPage() {
  const supabase = createClient();

  const [queue, ingredientsRes, aliasesRes, suppliersRes] = await Promise.all([
    loadMatchQueue(supabase),
    supabase
      .from("ingredients")
      .select("id, canonical_name, kind")
      .eq("active", true)
      .order("canonical_name")
      .returns<Pick<Ingredient, "id" | "canonical_name" | "kind">[]>(),
    supabase
      .from("ingredient_aliases")
      .select("ingredient_id, raw_text, supplier_id")
      .returns<Pick<IngredientAlias, "ingredient_id" | "raw_text" | "supplier_id">[]>(),
    supabase.from("suppliers").select("id, name").returns<Pick<Supplier, "id" | "name">[]>(),
  ]);

  const failed = ingredientsRes.error ?? aliasesRes.error ?? suppliersRes.error;
  if (failed) throw new Error(`Couldn't load ingredients: ${failed.message}`);

  const ingredients = ingredientsRes.data ?? [];
  const aliases = aliasesRes.data ?? [];
  const supplierNames = new Map((suppliersRes.data ?? []).map((s) => [s.id, s.name]));

  const rows: MatchRowData[] = queue.map((row) => {
    const { unit_price, price_basis } = row.latest;
    return {
      key: row.key,
      supplierId: row.supplierId,
      supplierName: row.supplierId
        ? (supplierNames.get(row.supplierId) ?? "Unknown supplier")
        : "No supplier",
      matchName: row.matchName,
      rawName: row.rawName,
      lineCount: row.lineCount,
      latestPrice:
        unit_price === null
          ? "—"
          : `${formatGBP(unit_price)}${price_basis ? BASIS_SUFFIX[price_basis] : " (basis not read)"}`,
      suggestions: suggestMatches(row.rawName, ingredients, aliases, row.supplierId),
    };
  });

  const totalLines = rows.reduce((n, r) => n + r.lineCount, 0);

  return (
    <div className="min-h-screen p-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold">Match ingredients</h1>
        <p className="text-sm text-neutral-500">
          Tell GP Guardian what each product is — once. Your answer is applied to every invoice line
          with that product and remembered, so it matches by itself next time.
        </p>
        {rows.length > 0 && (
          <p className="mt-2 text-sm text-neutral-700">
            {rows.length} {rows.length === 1 ? "product" : "products"} to match, covering{" "}
            {totalLines} invoice {totalLines === 1 ? "line" : "lines"}.
          </p>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="max-w-3xl rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-800">
          All matched ✓ — every invoice line has an ingredient.
        </p>
      ) : (
        <MatchQueue rows={rows} ingredients={ingredients} />
      )}
    </div>
  );
}
