// POST /api/documents/[id]/confirm
//
// The chef signs the invoice off: review_status → 'confirmed'. From here its lines are
// locked (the PATCH route refuses edits) and it can't be deleted.
//
// 409 unless EVERY line is verified — "AI extracts, human confirms" (non-negotiable #2)
// means no line reaches costing without a human having looked at it.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/types/database";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, processing_status, review_status")
    .eq("id", params.id)
    .maybeSingle<Pick<DocumentRow, "id" | "processing_status" | "review_status">>();
  if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  if (doc.review_status === "confirmed") {
    return NextResponse.json({ ok: true }); // already done — confirming twice is harmless
  }
  if (doc.processing_status !== "extracted") {
    return NextResponse.json(
      { error: "This invoice hasn't been read yet, so there's nothing to confirm." },
      { status: 409 }
    );
  }

  const { count, error: countError } = await supabase
    .from("invoice_lines")
    .select("id", { count: "exact", head: true })
    .eq("document_id", doc.id)
    .is("verified_at", null);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  const unverified = count ?? 0;
  if (unverified > 0) {
    return NextResponse.json(
      {
        error: `${unverified} ${unverified === 1 ? "line still needs" : "lines still need"} confirming first.`,
      },
      { status: 409 }
    );
  }

  const { error: updateError } = await supabase
    .from("documents")
    .update({ review_status: "confirmed" })
    .eq("id", doc.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
