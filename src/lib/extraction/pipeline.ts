// Extraction orchestration — the server-side flow that runs after a document is uploaded.
//
//   uploaded → [extracting] → extracted | failed
//
// Steps:
//   1. Flip processing_status to 'extracting' (so the UI stops showing "queued").
//   2. Download the file bytes from Storage.
//   3. Gather this venue's known aliases to prime the prompt (design doc §3).
//   4. Call the AI (extract.ts) → validated invoice.
//   5. Write invoice_lines — one row per readable line, NONE finalised (design doc #2:
//      AI extracts, human confirms). Unreadable lines are disregarded, never invented (§6).
//   6. Update the document's counters + header fields, set processing_status = 'extracted'.
//
// Anything that throws lands the document in 'failed' with a chef-readable
// extraction_error, so a broken extraction never masquerades as "just waiting".
//
// SERVER ONLY — pulls in the Anthropic key via extract.ts.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentRow } from "@/types/database";
import { STORAGE_BUCKET } from "@/lib/documents/upload";
import { extractInvoice } from "./extract";
import { buildInvoiceLineRows, type InvoiceLineRow } from "./lines";

type Supabase = SupabaseClient<Database>;

export interface ExtractionResult {
  linesDetected: number;
  linesExtracted: number;
  linesDisregarded: number;
}

/**
 * Runs the full pipeline for one document. The caller (the route handler) passes an
 * authenticated Supabase client so all reads/writes run as the signed-in user under RLS.
 */
export async function runExtraction(
  supabase: Supabase,
  documentId: string
): Promise<ExtractionResult> {
  // ── Load the document ──────────────────────────────────────
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single<DocumentRow>();

  if (docError || !doc) {
    throw new Error("Document not found.");
  }

  // Guard: only extract things that are waiting or previously failed. Re-extracting an
  // already-'extracted' doc would duplicate its invoice_lines — refuse rather than
  // quietly double-count spend.
  if (doc.processing_status === "extracting") {
    throw new Error("This document is already being read.");
  }
  if (doc.processing_status === "extracted") {
    throw new Error("This document has already been read.");
  }

  // ── Mark as extracting ─────────────────────────────────────
  await supabase
    .from("documents")
    .update({ processing_status: "extracting", extraction_error: null })
    .eq("id", documentId);

  try {
    // ── Download the file ────────────────────────────────────
    const { data: blob, error: dlError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(doc.file_url);

    if (dlError || !blob) {
      throw new Error("Couldn't retrieve the uploaded file from storage.");
    }
    const bytes = Buffer.from(await blob.arrayBuffer());

    // ── Prime the prompt with known aliases (design doc §3) ──
    const knownAliases = await fetchKnownAliases(supabase, doc.venue_id);

    // ── The AI call ──────────────────────────────────────────
    const invoice = await extractInvoice({
      bytes,
      mimeType: blob.type || "application/octet-stream",
      sourceFormat: doc.source_format,
      knownAliases,
    });

    // ── Write invoice_lines (never finalised) ────────────────
    // Every line is validated on its own first (see lines.ts). A line we can't store
    // cleanly is stored flagged, or disregarded and counted — but it can no longer take
    // the rest of the invoice down with it.
    const { rows, linesDisregarded: disregardedByValidation } = buildInvoiceLineRows(
      invoice,
      { venueId: doc.venue_id, documentId: doc.id }
    );

    const { saved, rejected } = await insertLines(supabase, rows);
    const linesDisregarded = disregardedByValidation + rejected;

    const linesExtracted = saved;
    // lines_detected is the AI's honest count of what it could see — but never let it
    // be less than what we actually stored + disregarded, so the maths can't go silly.
    const linesDetected = Math.max(
      invoice.lines_detected,
      linesExtracted + linesDisregarded
    );

    // ── Finalise the document row ────────────────────────────
    await supabase
      .from("documents")
      .update({
        processing_status: "extracted",
        extraction_error: null,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        lines_detected: linesDetected,
        lines_extracted: linesExtracted,
        lines_disregarded: linesDisregarded,
        lines_verified: 0, // nobody's confirmed anything yet — that's the review queue
        // Invoice-level charges (delivery, fuel surcharge…) live on the document, not as
        // product lines — otherwise "DELIVERY" turns up in the chef's matching queue
        // every week. They still count toward the invoice total.
        delivery_charge: invoice.delivery_charge,
        other_charges: invoice.other_charges,
        // Supplier matching (creating/linking a suppliers row from invoice.supplier_name)
        // is its own slice — left null for now rather than half-built.
      })
      .eq("id", documentId);

    return { linesDetected, linesExtracted, linesDisregarded };
  } catch (err) {
    // Land the document in 'failed' with a message the chef can act on, rather than
    // leaving it silently stuck in 'extracting'.
    const message = err instanceof Error ? err.message : "Extraction failed unexpectedly.";
    await supabase
      .from("documents")
      .update({ processing_status: "failed", extraction_error: message })
      .eq("id", documentId);
    throw err; // let the route handler report it too
  }
}

/**
 * Insert the validated rows, and make damn sure one unforeseen bad value can't cost us
 * the whole invoice.
 *
 * Fast path: one batch insert (a single round trip — what we want 99% of the time).
 * Slow path: if that batch is rejected, retry the rows ONE AT A TIME so we keep every
 * line the database is willing to accept and only lose the genuinely broken ones.
 *
 * lines.ts already screens out the failure we know about (the INV-04 non-integer
 * pack_count). This is the safety net for the ones we haven't met yet — a new NOT NULL
 * column, a check constraint we forget to mirror in the validator. Cheap insurance:
 * it only costs extra round trips on an invoice that was already in trouble.
 */
async function insertLines(
  supabase: Supabase,
  rows: InvoiceLineRow[]
): Promise<{ saved: number; rejected: number }> {
  if (rows.length === 0) return { saved: 0, rejected: 0 };

  const batch = await supabase.from("invoice_lines").insert(rows);
  if (!batch.error) return { saved: rows.length, rejected: 0 };

  let saved = 0;
  let rejected = 0;
  for (const row of rows) {
    const one = await supabase.from("invoice_lines").insert([row]);
    if (one.error) rejected += 1;
    else saved += 1;
  }

  // Every single row failed → this isn't a bad line, it's a broken table or a broken
  // connection. Surface it rather than reporting a cheerfully empty invoice.
  if (saved === 0) {
    throw new Error(
      `Read the invoice but couldn't save any of its lines: ${batch.error.message}`
    );
  }

  return { saved, rejected };
}

/**
 * The venue's known raw product strings — from confirmed ingredient aliases and from
 * supplier products seen before. Deduplicated, capped so the prompt can't balloon on a
 * venue with thousands of products.
 */
async function fetchKnownAliases(supabase: Supabase, venueId: string): Promise<string[]> {
  const [aliases, products] = await Promise.all([
    supabase.from("ingredient_aliases").select("raw_text").eq("venue_id", venueId),
    supabase.from("supplier_products").select("raw_product_name").eq("venue_id", venueId),
  ]);

  const set = new Set<string>();
  for (const a of aliases.data ?? []) if (a.raw_text) set.add(a.raw_text);
  for (const p of products.data ?? []) if (p.raw_product_name) set.add(p.raw_product_name);

  return Array.from(set).slice(0, 200); // plenty of context without bloating the prompt
}
