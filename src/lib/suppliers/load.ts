// Loads everything the /suppliers screens need in three queries, then groups it in
// memory. Server-only in practice (it's given the server Supabase client).
//
// ponytail: loads the venue's whole invoice history, same as the documents page. Fine
// for one kitchen; if it gets slow, filter by supplier in SQL on the detail page first.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentRow, Supplier } from "@/types/database";
import type { PriceLine } from "@/lib/prices/compare";

export type SupplierDoc = Pick<
  DocumentRow,
  | "id"
  | "supplier_id"
  | "invoice_number"
  | "invoice_date"
  | "delivery_charge"
  | "other_charges"
  | "created_at"
>;
export type SupplierLine = PriceLine & { document_id: string };

export interface SupplierData {
  suppliers: Supplier[];
  docsBySupplier: Map<string, SupplierDoc[]>; // newest invoice first
  linesByDoc: Map<string, SupplierLine[]>;
  /** Invoices with no supplier linked (read before supplier linking, or name unreadable). */
  unlinkedInvoiceCount: number;
}

/**
 * Newest invoice first: by invoice_date, then upload time as a tie-break. Invoices with
 * no date sort last — we can't say they're the newest.
 */
export function newestFirst(a: SupplierDoc, b: SupplierDoc): number {
  if (a.invoice_date !== b.invoice_date) {
    if (a.invoice_date === null) return 1;
    if (b.invoice_date === null) return -1;
    return a.invoice_date < b.invoice_date ? 1 : -1;
  }
  return a.created_at < b.created_at ? 1 : -1;
}

export async function loadSupplierData(supabase: SupabaseClient<Database>): Promise<SupplierData> {
  const [suppliersRes, docsRes, linesRes] = await Promise.all([
    supabase.from("suppliers").select("*").returns<Supplier[]>(),
    supabase
      .from("documents")
      .select(
        "id, supplier_id, invoice_number, invoice_date, delivery_charge, other_charges, created_at"
      )
      .eq("document_type", "invoice")
      .returns<SupplierDoc[]>(),
    supabase
      .from("invoice_lines")
      .select(
        "document_id, supplier_id, product_name_raw, price_basis, unit, pack_count, unit_weight_min, unit_weight_max, unit_price, total_price, extraction_status, invoice_number, invoice_date"
      )
      .returns<SupplierLine[]>(),
  ]);

  // A failed query must not render as "£0 spent" — that's a guess on money.
  const failed = suppliersRes.error ?? docsRes.error ?? linesRes.error;
  if (failed) throw new Error(`Couldn't load supplier data: ${failed.message}`);

  const docsBySupplier = new Map<string, SupplierDoc[]>();
  let unlinkedInvoiceCount = 0;
  for (const doc of docsRes.data ?? []) {
    if (!doc.supplier_id) {
      unlinkedInvoiceCount += 1;
      continue;
    }
    docsBySupplier.set(doc.supplier_id, [...(docsBySupplier.get(doc.supplier_id) ?? []), doc]);
  }
  for (const docs of docsBySupplier.values()) docs.sort(newestFirst);

  // Lines are grouped by DOCUMENT, not by their own supplier_id, so a supplier's totals
  // always add up to exactly the invoices listed under it.
  const linesByDoc = new Map<string, SupplierLine[]>();
  for (const line of linesRes.data ?? []) {
    linesByDoc.set(line.document_id, [...(linesByDoc.get(line.document_id) ?? []), line]);
  }

  return {
    suppliers: suppliersRes.data ?? [],
    docsBySupplier,
    linesByDoc,
    unlinkedInvoiceCount,
  };
}

/** All lines on a list of invoices, flattened. */
export function linesFor(docs: SupplierDoc[], linesByDoc: Map<string, SupplierLine[]>) {
  return docs.flatMap((d) => linesByDoc.get(d.id) ?? []);
}
