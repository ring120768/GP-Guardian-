// PATCH /api/ingredients/[id] — edit an ingredient's yield %.
//
// Body: { yield_percent: 1–100 }. 100 = off. Only used for in-house butchery/filleting
// (CLAUDE.md "Money rules"). Never 0 — costing divides by it; the DB checks this too.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createClient } from "@/lib/supabase/server";

const BodySchema = z
  .object({
    yield_percent: z
      .number()
      .min(1, "Yield must be at least 1%.")
      .max(100, "Yield can't be more than 100%."),
  })
  .strict();

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

  const { data, error } = await supabase
    .from("ingredients")
    .update(parsed.data)
    .eq("id", params.id)
    .select("id, yield_percent")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ingredient not found." }, { status: 404 });

  return NextResponse.json({ ok: true, ingredient: data });
}
