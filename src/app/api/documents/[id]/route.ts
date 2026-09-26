// DELETE /api/documents/[id]
//
// Removes an unconfirmed document: its row (invoice_lines go with it via
// ON DELETE CASCADE) and then its file in the private `documents` bucket.
//
// Order matters, and it's the reverse of upload (src/lib/documents/upload.ts):
//   1. Delete the ROW first. If that fails we stop — nothing has changed.
//   2. Then remove the FILE. If that fails we still report success and log it.
// An orphaned file in Storage is harmless clutter. A row pointing at a missing file
// is a broken card the chef can't open — so the row always goes first.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canDeleteDocument } from "@/lib/documents/delete";
import { STORAGE_BUCKET } from "@/lib/documents/upload";
import type { DocumentRow } from "@/types/database";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  // Same check as the extract route — middleware already blocks signed-out users,
  // this is defence in depth on a route that destroys data.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: doc, error: fetchError } = await supabase
    .from("documents")
    .select("id, file_url, review_status")
    .eq("id", params.id)
    .maybeSingle<Pick<DocumentRow, "id" | "file_url" | "review_status">>();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const check = canDeleteDocument(doc);
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason }, { status: 409 });
  }

  // ── Step 1: the row (invoice_lines cascade) ────────────────
  // The .neq() repeats the confirmed-check inside the DELETE itself, so if the chef
  // confirms this invoice in another tab between our read above and this line,
  // Postgres deletes nothing rather than wiping a just-confirmed invoice.
  const { data: deleted, error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("id", doc.id)
    .neq("review_status", "confirmed")
    .select("id");

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json(
      { error: "This invoice changed while you were deleting it — refresh and try again." },
      { status: 409 }
    );
  }

  // ── Step 2: the file (best-effort) ─────────────────────────
  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([doc.file_url]);
  if (storageError) {
    console.error(
      `[delete-document] Row ${doc.id} deleted but file "${doc.file_url}" wasn't removed:`,
      storageError.message
    );
  }

  return NextResponse.json({ ok: true });
}
