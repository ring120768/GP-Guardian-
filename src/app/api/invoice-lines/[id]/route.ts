// PATCH /api/invoice-lines/[id]
//
// The chef edits and/or confirms one invoice line. Body (all optional):
//   { product_name_raw?, qty_ordered?, pack_count?, ..., confirm?: boolean }
//
// Rules:
//   • A CONFIRMED invoice is locked (409) — its lines already feed costing.
//   • Changing any value UN-confirms the line (verified_at → null), unless the same
//     request also says confirm: true ("save & confirm").
//   • The FIRST edit snapshots the AI's values into ai_original, so we can measure
//     extraction accuracy later. Never overwritten after that.
//   • documents.lines_verified and review_status are recounted after every change.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { LineEditSchema, snapshotEditable, EDITABLE_FIELDS } from "@/lib/review/edit";
import type { Database, DocumentRow, InvoiceLine } from "@/types/database";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();

  // Defence in depth — middleware already blocks signed-out users.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // ── Validate the body ──────────────────────────────────────
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = LineEditSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first.path.join(".") || "body"}: ${first.message}` },
      { status: 400 }
    );
  }
  const { confirm, ...edits } = parsed.data;

  // ── Load the line and its invoice ──────────────────────────
  const { data: line, error: lineError } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<InvoiceLine>();
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  if (!line) return NextResponse.json({ error: "Line not found." }, { status: 404 });

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, review_status")
    .eq("id", line.document_id)
    .single<Pick<DocumentRow, "id" | "review_status">>();
  if (docError || !doc) {
    return NextResponse.json({ error: docError?.message ?? "Invoice not found." }, { status: 500 });
  }
  if (doc.review_status === "confirmed") {
    return NextResponse.json(
      { error: "This invoice is confirmed — its lines can't be changed." },
      { status: 409 }
    );
  }

  // ── Work out what actually changed ─────────────────────────
  // Only real changes count. Re-sending the same value (e.g. a field that lost focus
  // without being edited) must not un-confirm a line the chef already confirmed.
  const changed: Partial<InvoiceLine> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = edits[field];
    if (value !== undefined && value !== line[field]) {
      (changed as Record<string, unknown>)[field] = value;
    }
  }
  const hasChanges = Object.keys(changed).length > 0;

  // Cross-field check against the MERGED line, since the chef may change just one end.
  const min =
    changed.unit_weight_min !== undefined ? changed.unit_weight_min : line.unit_weight_min;
  const max =
    changed.unit_weight_max !== undefined ? changed.unit_weight_max : line.unit_weight_max;
  if (min !== null && max !== null && min > max) {
    return NextResponse.json(
      { error: "Minimum weight can't be more than the maximum." },
      { status: 400 }
    );
  }

  const update: Partial<InvoiceLine> = { ...changed };
  if (hasChanges) {
    // First edit ever → keep what the AI said before we overwrite it.
    if (line.ai_original === null) update.ai_original = snapshotEditable(line);
    update.verified_at = null; // edit = un-confirm…
  }
  if (confirm === true) update.verified_at = new Date().toISOString(); // …unless confirming too
  if (confirm === false) update.verified_at = null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, line }); // nothing to do
  }

  const { data: saved, error: saveError } = await supabase
    .from("invoice_lines")
    .update(update)
    .eq("id", line.id)
    .select("*")
    .single<InvoiceLine>();
  if (saveError || !saved) {
    return NextResponse.json({ error: saveError?.message ?? "Couldn't save." }, { status: 500 });
  }

  const linesVerified = await syncVerification(supabase, line.document_id);
  return NextResponse.json({ ok: true, line: saved, linesVerified });
}

/**
 * Recount verified lines and set documents.lines_verified + review_status to match.
 *
 * A recount rather than +1/-1: counters that are nudged drift the first time a request
 * fails halfway. A count is always right.
 *
 *   0 verified          → 'pending'
 *   some or all verified → 'in_review'  (only the explicit Confirm invoice makes it
 *                                        'confirmed' — all lines ticked isn't the same
 *                                        as the chef signing the invoice off)
 */
async function syncVerification(
  supabase: SupabaseClient<Database>,
  documentId: string
): Promise<number> {
  const { count } = await supabase
    .from("invoice_lines")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .not("verified_at", "is", null);
  const linesVerified = count ?? 0;

  await supabase
    .from("documents")
    .update({
      lines_verified: linesVerified,
      review_status: linesVerified > 0 ? "in_review" : "pending",
    })
    .eq("id", documentId)
    // Never knock a confirmed invoice back to in_review (e.g. a race with Confirm).
    .neq("review_status", "confirmed");

  return linesVerified;
}
