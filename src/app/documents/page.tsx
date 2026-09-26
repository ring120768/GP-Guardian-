// Documents screen — upload invoices and see what's been uploaded.
//
// Server component: reads the venue + document list on the server (fast, no client
// round-trip, no exposed queries), then hands the interactive upload widget off to a
// client component. This is the standard App Router split — data on the server,
// interactivity on the client.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DocumentUploader } from "@/components/DocumentUploader";
import { DocumentCard } from "@/components/DocumentCard";
import type { DocumentRow, Supplier, Venue } from "@/types/database";
import { comparePrices, type PriceComparison, type PriceLine } from "@/lib/prices/compare";

// Only these are worth a line on the card. 'same', 'new' and 'skipped' would just be noise.
const SHOWN_STATUSES = new Set(["up", "down", "pack_changed"]);

export default async function DocumentsPage() {
  const supabase = createClient();

  // Single venue for MVP — grab the first (and only) one. When multi-tenancy lands
  // this becomes "the venue this user belongs to".
  const { data: venue } = await supabase
    .from("venues")
    .select("*")
    .limit(1)
    .single<Venue>();

  const { data: documents } = await supabase
    .from("documents")
    .select("*")
    .eq("document_type", "invoice")
    .order("created_at", { ascending: false })
    .returns<DocumentRow[]>();

  // Every invoice line, for price-change alerts. Only the columns comparePrices needs.
  // ponytail: loads the venue's whole line history on every page view. Fine for months
  // of one kitchen's invoices; if it gets slow, only load lines for the suppliers on
  // screen, or keep a latest-price-per-product table (supplier_products has the columns).
  const { data: lines } = await supabase
    .from("invoice_lines")
    .select(
      "document_id, supplier_id, product_name_raw, price_basis, unit, pack_count, unit_weight_min, unit_weight_max, unit_price, total_price, extraction_status, invoice_number, invoice_date",
    )
    .returns<(PriceLine & { document_id: string })[]>();

  // Supplier names for the card links. One small query; a venue has dozens, not thousands.
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .returns<Pick<Supplier, "id" | "name">[]>();
  const supplierNames = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  // Group once, so each card only compares against its own supplier's lines instead of
  // scanning every line the venue has ever had.
  const linesByDoc = new Map<string, PriceLine[]>();
  const linesBySupplier = new Map<string, PriceLine[]>();
  for (const l of lines ?? []) {
    linesByDoc.set(l.document_id, [...(linesByDoc.get(l.document_id) ?? []), l]);
    if (l.supplier_id) {
      linesBySupplier.set(l.supplier_id, [...(linesBySupplier.get(l.supplier_id) ?? []), l]);
    }
  }

  function priceChangesFor(doc: DocumentRow): PriceComparison[] {
    if (!doc.supplier_id) return []; // no supplier → nothing to compare against
    return comparePrices(
      linesByDoc.get(doc.id) ?? [],
      linesBySupplier.get(doc.supplier_id) ?? [],
    ).filter((r) => SHOWN_STATUSES.has(r.status));
  }

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <p className="text-sm">
          <Link href="/" className="text-neutral-500 hover:underline">
            ← Dashboard
          </Link>
          {" · "}
          <Link href="/suppliers" className="text-neutral-500 hover:underline">
            Suppliers
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Invoices</h1>
        <p className="text-sm text-neutral-500">
          Upload supplier invoices — photos or PDFs. The chef confirms; nothing is
          finalised automatically.
        </p>
      </header>

      {venue ? (
        <section className="mb-10 max-w-2xl">
          <DocumentUploader venueId={venue.id} documentType="invoice" />
        </section>
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No venue found. Run the seed in <code>0001_init.sql</code> (it inserts the
          default &ldquo;My Kitchen&rdquo; venue).
        </p>
      )}

      <section className="max-w-2xl space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">
          Uploaded ({documents?.length ?? 0})
        </h2>
        {documents && documents.length > 0 ? (
          documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              supplierName={doc.supplier_id ? (supplierNames.get(doc.supplier_id) ?? null) : null}
              priceChanges={priceChangesFor(doc)}
            />
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
            Nothing uploaded yet. Drop an invoice above to get started.
          </p>
        )}
      </section>
    </div>
  );
}
