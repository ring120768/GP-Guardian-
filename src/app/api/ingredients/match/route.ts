// POST /api/ingredients/match
//
// The chef answers one row of the Match ingredients queue. Body:
//   { supplierId, matchName, action }
//   action = { type: "existing", ingredientId, fromSuggestion }   ← [Confirm] / [Choose…]
//          | { type: "new", name, defaultUnit, kind }             ← [New ingredient]
//          | { type: "not_food" }                                  ← [Not food]
//
// Then, in this order:
//   1. Work out the ingredient (existing, or find-or-create).
//   2. Write the ALIAS (venue, matchName, supplier) → the next invoice with this product
//      auto-matches in the extraction pipeline with zero clicks (design doc §3 step 4).
//   3. Set ingredient_id on EVERY unmatched line in this group — retroactive, so a
//      month of backfilled invoices is sorted by one answer (design doc §5.3).
//
// Alias before lines: if step 3 fails, re-answering the row just rewrites the same
// alias and retries — nothing is left half-done in a way that can't be repeated.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { matchText } from "@/lib/matching/match";
import type { Database, Ingredient, IngredientKind, InvoiceLine } from "@/types/database";

const BodySchema = z.object({
  supplierId: z.string().nullable(),
  matchName: z.string().min(1),
  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("existing"),
      ingredientId: z.string().min(1),
      // Took the suggestion as offered → 'fuzzy_confirmed'. Picked by hand → 'manual'.
      fromSuggestion: z.boolean(),
    }),
    z.object({
      type: z.literal("new"),
      name: z.string().trim().min(1, "Give the ingredient a name."),
      defaultUnit: z.enum(["g", "ml", "unit"]),
      kind: z.enum(["food", "non_food", "by_product"]),
    }),
    z.object({ type: z.literal("not_food") }),
  ]),
});

type Supabase = SupabaseClient<Database>;

export async function POST(request: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { supplierId, matchName, action } = parsed.data;

  // ── The group: unmatched lines, same supplier, same matchText ──
  // Filtered in JS because matchText is TypeScript — Postgres can't compute it.
  let query = supabase
    .from("invoice_lines")
    .select("id, venue_id, product_name_raw")
    .is("ingredient_id", null);
  query = supplierId ? query.eq("supplier_id", supplierId) : query.is("supplier_id", null);
  const { data: candidates, error: linesError } =
    await query.returns<Pick<InvoiceLine, "id" | "venue_id" | "product_name_raw">[]>();
  if (linesError) return NextResponse.json({ error: linesError.message }, { status: 500 });

  const group = (candidates ?? []).filter((l) => matchText(l.product_name_raw) === matchName);
  if (group.length === 0) {
    return NextResponse.json(
      { error: "These lines are already matched — refresh the page." },
      { status: 409 }
    );
  }
  const venueId = group[0].venue_id;

  try {
    // ── 1. The ingredient ────────────────────────────────────
    let ingredientId: string;
    if (action.type === "existing") {
      const { data: ing } = await supabase
        .from("ingredients")
        .select("id")
        .eq("id", action.ingredientId)
        .eq("venue_id", venueId)
        .maybeSingle();
      if (!ing) return NextResponse.json({ error: "Ingredient not found." }, { status: 404 });
      ingredientId = ing.id;
    } else if (action.type === "new") {
      ingredientId = await findOrCreateIngredient(
        supabase,
        venueId,
        action.name,
        action.defaultUnit,
        action.kind
      );
    } else {
      // Not food: its own non_food ingredient named after the product ("Blue roll"),
      // so its price is still tracked on /ingredients — it just never reaches a recipe.
      const name = matchName.charAt(0).toUpperCase() + matchName.slice(1);
      ingredientId = await findOrCreateIngredient(supabase, venueId, name, "unit", "non_food");
    }

    // ── 2. The alias — what makes it zero clicks next time ───
    const matchType =
      action.type === "existing" && action.fromSuggestion ? "fuzzy_confirmed" : "manual";
    await upsertAlias(supabase, venueId, matchName, supplierId, ingredientId, matchType);

    // ── 3. Every line in the group, retroactively ────────────
    // .is(null) again: never overwrite a line that got matched in the meantime.
    const { data: updated, error: updateError } = await supabase
      .from("invoice_lines")
      .update({ ingredient_id: ingredientId, match_confidence: "high" })
      .in(
        "id",
        group.map((l) => l.id)
      )
      .is("ingredient_id", null)
      .select("id");
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, ingredientId, linesUpdated: updated?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Reuse an ingredient with the same name (trimmed, any case) rather than making a second
 * "Butter". Compared in JS, not with ilike — ilike treats % and _ as wildcards.
 */
async function findOrCreateIngredient(
  supabase: Supabase,
  venueId: string,
  name: string,
  defaultUnit: Ingredient["default_unit"],
  kind: IngredientKind
): Promise<string> {
  const { data: existing, error } = await supabase
    .from("ingredients")
    .select("id, canonical_name")
    .eq("venue_id", venueId);
  if (error) throw new Error(`Couldn't look up ingredients: ${error.message}`);

  const wanted = name.trim().toLowerCase();
  const match = (existing ?? []).find((i) => i.canonical_name.trim().toLowerCase() === wanted);
  if (match) return match.id;

  const { data: created, error: insertError } = await supabase
    .from("ingredients")
    .insert({ venue_id: venueId, canonical_name: name.trim(), default_unit: defaultUnit, kind })
    .select("id")
    .single();
  if (insertError || !created) {
    throw new Error(`Couldn't create "${name}": ${insertError?.message}`);
  }
  return created.id;
}

/**
 * One alias per (venue, text, supplier). Select-then-write rather than .upsert(): the
 * unique constraint includes supplier_id, and Postgres treats NULLs as distinct, so an
 * upsert on a supplier-less alias would quietly insert a duplicate every time.
 */
async function upsertAlias(
  supabase: Supabase,
  venueId: string,
  rawText: string,
  supplierId: string | null,
  ingredientId: string,
  matchType: "fuzzy_confirmed" | "manual"
) {
  let query = supabase
    .from("ingredient_aliases")
    .select("id")
    .eq("venue_id", venueId)
    .eq("raw_text", rawText);
  query = supplierId ? query.eq("supplier_id", supplierId) : query.is("supplier_id", null);
  const { data: existing, error } = await query.maybeSingle();
  if (error) throw new Error(`Couldn't look up aliases: ${error.message}`);

  const { error: writeError } = existing
    ? await supabase
        .from("ingredient_aliases")
        .update({ ingredient_id: ingredientId, match_type: matchType })
        .eq("id", existing.id)
    : await supabase.from("ingredient_aliases").insert({
        venue_id: venueId,
        ingredient_id: ingredientId,
        raw_text: rawText,
        supplier_id: supplierId,
        match_type: matchType,
      });
  if (writeError) throw new Error(`Couldn't save the match: ${writeError.message}`);
}
