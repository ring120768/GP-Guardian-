// POST /api/documents/[id]/extract
//
// Triggers the AI extraction pipeline for one uploaded document. Server-side by
// necessity — this is the only place the Anthropic key is used, and it must never
// reach the browser.
//
// Auth: uses the cookie-backed Supabase server client, so the request runs as the
// signed-in user under the same RLS the rest of the app uses. An unauthenticated
// caller can't reach this (middleware redirects to /login), but we double-check the
// user anyway — defence in depth on a route that spends money.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runExtraction } from "@/lib/extraction/pipeline";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const result = await runExtraction(supabase, params.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // The pipeline has already recorded the failure on the document row
    // (processing_status = 'failed' + extraction_error). We just surface a clean message.
    const message = err instanceof Error ? err.message : "Extraction failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
