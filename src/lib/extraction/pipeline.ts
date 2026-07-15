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
import { confidenceToExtractionStatus } from "./schema";

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
    // Build rows only for readable lines; unreadable ones are disregarded (design doc §6).
    let linesDisregarded = 0;
    const rows = invoice.lines.flatMap((line) => {
      const extractionStatus = confidenceToExtractionStatus(line.confidence);
      if (extractionStatus === null) {
        linesDisregarded += 1;
        return []; // unreadable → skip, count it, never guess its numbers
      }
      return [
        {
          venue_id: doc.venue_id,
          document_id: doc.id,
          product_name_raw: line.product_name_raw,
          pack_count: line.pack_count,
          unit_weight_min: line.unit_weight_min,
          unit_weight_max: line.unit_weight_max,
          unit: line.unit,
          unit_price: line.unit_price,
          total_price: line.total_price,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          extraction_status: extractionStatus,
          // NOT matched to an ingredient and NOT finalised — the alias-matching slice
          // (design doc §3) and the review/confirm UI come next. Every line starts life
          // as "unmatched", waiting for a human. This is principle #2 made concrete.
          match_confidence: "unmatched" as const,
          // is_estimated defaults true in the schema; costing recalculates it later.
        },
      ];
    });

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("invoice_lines").insert(rows);
      if (insertError) {
        throw new Error(`Extracted the invoice but couldn't save the lines: ${insertError.message}`);
      }
    }

    const linesExtracted = rows.length;
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
