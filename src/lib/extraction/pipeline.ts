// Extraction orchestration — the server-side flow that runs after a document is uploaded.
//
//   uploaded → [extracting] → extracted | failed
//
// Steps:
//   1. Flip processing_status to 'extracting' (so the UI stops showing "queued").
//   2. Download the file bytes from Storage.
//   3. Gather this venue's known aliases to prime the prompt (design doc §3).
//   4. Call the AI (extract.ts) → validated invoice.
//   5. Link the supplier (find-or-create) and save the header — BEFORE any lines.
//   5b. Write invoice_lines — one row per readable line, NONE finalised (design doc #2:
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
import { findExactAlias } from "@/lib/matching/match";

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

    // ── Link the supplier + save the header, BEFORE any lines ─
    // Order matters here. documents has a unique index on (venue, supplier, invoice
    // number, date) — the duplicate-invoice check from design doc Part A §5. It only
    // bites once supplier_id is set, i.e. from now on. Saving the header first means a
    // duplicate upload fails HERE, before we've written a second copy of its lines.
    const supplierNameRaw = invoice.supplier_name?.trim() || null;
    const supplierId = supplierNameRaw
      ? await findOrCreateSupplier(supabase, doc.venue_id, supplierNameRaw)
      : null; // no readable supplier name → honestly unlinked, not guessed

    const { error: headerError } = await supabase
      .from("documents")
      .update({
        supplier_id: supplierId,
        supplier_name_raw: supplierNameRaw,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
      })
      .eq("id", documentId);

    if (headerError) {
      // 23505 = Postgres "unique violation".
      if (headerError.code === "23505") {
        throw new Error(
          "This looks like a duplicate — an invoice from the same supplier with the same number and date is already uploaded. Delete this copy."
        );
      }
      throw new Error(`Couldn't save the invoice details: ${headerError.message}`);
    }

    // ── Write invoice_lines (never finalised) ────────────────
    // Every line is validated on its own first (see lines.ts). A line we can't store
    // cleanly is stored flagged, or disregarded and counted — but it can no longer take
    // the rest of the invoice down with it.
    const { rows, linesDisregarded: disregardedByValidation } = buildInvoiceLineRows(
      invoice,
      { venueId: doc.venue_id, documentId: doc.id, supplierId }
    );

    // ── Auto-match known products (design doc §3 step 2) ─────
    // Any line whose product the chef has matched before gets its ingredient now, with
    // zero clicks. Everything else stays 'unmatched' for the Match ingredients queue.
    const aliases = await fetchAliases(supabase, doc.venue_id);
    for (const row of rows) {
      const ingredientId = findExactAlias(row.product_name_raw, aliases, supplierId);
      if (ingredientId) {
        row.ingredient_id = ingredientId;
        row.match_confidence = "high";
      }
    }

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
        lines_detected: linesDetected,
        lines_extracted: linesExtracted,
        lines_disregarded: linesDisregarded,
        lines_verified: 0, // nobody's confirmed anything yet — that's the review queue
        // Invoice-level charges (delivery, fuel surcharge…) live on the document, not as
        // product lines — otherwise "DELIVERY" turns up in the chef's matching queue
        // every week. They still count toward the invoice total.
        delivery_charge: invoice.delivery_charge,
        other_charges: invoice.other_charges,
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
 * Find this venue's supplier by name, or create it. Returns the supplier id.
 *
 * Match rule: trimmed, case-insensitive, otherwise EXACT. "Browns Meats" matches
 * "BROWNS MEATS " but not "Browns Meats Ltd" — anything fuzzier risks merging two
 * different suppliers' prices, which would make every price alert wrong. Near-misses
 * just create a second supplier; merging them is a job for a human later.
 *
 * Why compare in JS instead of `.ilike("name", name)`: ilike treats % and _ as
 * wildcards, so a supplier called "100% BEEF CO" would match things it shouldn't.
 * A venue has dozens of suppliers, not thousands, so loading them all is cheap.
 */
async function findOrCreateSupplier(
  supabase: Supabase,
  venueId: string,
  name: string
): Promise<string> {
  const { data: suppliers, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("venue_id", venueId);
  if (error) throw new Error(`Couldn't look up suppliers: ${error.message}`);

  const wanted = name.trim().toLowerCase();
  const existing = (suppliers ?? []).find((s) => s.name.trim().toLowerCase() === wanted);
  if (existing) return existing.id;

  // ponytail: two brand-new invoices from the same new supplier extracted at the same
  // instant could each create a row. A unique index on (venue_id, lower(trim(name)))
  // would close that gap if it ever happens.
  const { data: created, error: insertError } = await supabase
    .from("suppliers")
    .insert({ venue_id: venueId, name: name.trim() })
    .select("id")
    .single();
  if (insertError || !created) {
    throw new Error(`Couldn't save the supplier "${name}": ${insertError?.message}`);
  }
  return created.id;
}

/** The venue's confirmed matches, for auto-matching new lines. */
async function fetchAliases(supabase: Supabase, venueId: string) {
  const { data, error } = await supabase
    .from("ingredient_aliases")
    .select("ingredient_id, raw_text, supplier_id")
    .eq("venue_id", venueId);
  // Not fatal: without aliases every line just lands in the queue, which is safe.
  if (error) console.error("[extraction] Couldn't load aliases for auto-match:", error.message);
  return data ?? [];
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
