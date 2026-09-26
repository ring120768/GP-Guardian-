// PATCH /api/ingredients/[id] — rename an ingredient and/or change its yield %.
//
// Body: { canonical_name?, yield_percent? } — at least one.
//
// RENAMING IS SAFE FOR MATCHING: aliases and invoice lines point at the ingredient's
// id, never its name. Renaming "Chix supreme skin-on" to "Chicken supreme" changes what
// the chef sees and nothing else — every alias keeps auto-matching.
//
// Yield: 1–100, 100 = off. Only for in-house butchery/filleting (CLAUDE.md "Money
// rules"). Never 0 — costing divides by it; the DB checks this too.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createClient } from "@/lib/supabase/server";
import type { Ingredient } from "@/types/database";

const BodySchema = z
  .object({
    canonical_name: z.string().trim().min(1, "Name can't be blank."),
    yield_percent: z
      .number()
      .min(1, "Yield must be at least 1%.")
      .max(100, "Yield can't be more than 100%."),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { data: ingredient } = await supabase
    .from("ingredients")
    .select("id, venue_id")
    .eq("id", params.id)
    .maybeSingle<Pick<Ingredient, "id" | "venue_id">>();
  if (!ingredient) return NextResponse.json({ error: "Ingredient not found." }, { status: 404 });

  // Two ingredients with the same name would make "Choose…" in the match queue a coin
  // toss. Same check as matching's find-or-create: trimmed, any case, compared in JS.
  const newName = parsed.data.canonical_name;
  if (newName !== undefined) {
    const { data: others } = await supabase
      .from("ingredients")
      .select("id, canonical_name")
      .eq("venue_id", ingredient.venue_id)
      .neq("id", ingredient.id);
    const clash = (others ?? []).find(
      (i) => i.canonical_name.trim().toLowerCase() === newName.toLowerCase()
    );
    if (clash) {
      return NextResponse.json(
        { error: `There's already an ingredient called "${clash.canonical_name}".` },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase
    .from("ingredients")
    .update(parsed.data)
    .eq("id", ingredient.id)
    .select("id, canonical_name, yield_percent")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ingredient not found." }, { status: 404 });

  return NextResponse.json({ ok: true, ingredient: data });
}
