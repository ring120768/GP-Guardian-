// Documents screen — upload invoices and see what's been uploaded.
//
// Server component: reads the venue + document list on the server (fast, no client
// round-trip, no exposed queries), then hands the interactive upload widget off to a
// client component. This is the standard App Router split — data on the server,
// interactivity on the client.

import { createClient } from "@/lib/supabase/server";
import { DocumentUploader } from "@/components/DocumentUploader";
import { DocumentCard } from "@/components/DocumentCard";
import type { DocumentRow, Venue } from "@/types/database";

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

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Invoices</h1>
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
          documents.map((doc) => <DocumentCard key={doc.id} doc={doc} />)
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
            Nothing uploaded yet. Drop an invoice above to get started.
          </p>
        )}
      </section>
    </div>
  );
}
