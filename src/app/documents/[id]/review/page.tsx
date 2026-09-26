// Review & Confirm — design doc §6, non-negotiable #2: AI extracts, human confirms.
//
// Original document on the left, what the AI read on the right. The chef checks each
// line against the paper, fixes anything wrong, confirms it, and finally confirms the
// invoice. Nothing reaches costing until that last step.
//
// Server component for the data; the editable table is a client component
// (ReviewLines) because it has to hold what the chef is typing.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { STORAGE_BUCKET } from "@/lib/documents/upload";
import { extractionPercent, verifiedPercent } from "@/lib/documents/health";
import { ReviewLines } from "@/components/ReviewLines";
import { formatDate, formatGBP } from "@/lib/format";
import type { DocumentRow, InvoiceLine, Supplier } from "@/types/database";

/** 10 minutes: enough to review an invoice; a leaked link goes dead quickly. */
const SIGNED_URL_SECONDS = 600;

export default async function ReviewPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<DocumentRow>();
  if (!doc) notFound();

  const [linesRes, supplierRes, signedRes] = await Promise.all([
    supabase
      .from("invoice_lines")
      .select("*")
      .eq("document_id", doc.id)
      // ponytail: lines are batch-inserted with the same created_at, so within one
      // invoice this relies on Postgres returning them in insert order — true in
      // practice, not guaranteed. A line_number column would make it exact.
      .order("created_at")
      .returns<InvoiceLine[]>(),
    doc.supplier_id
      ? supabase
          .from("suppliers")
          .select("name")
          .eq("id", doc.supplier_id)
          .maybeSingle<Pick<Supplier, "name">>()
      : Promise.resolve({ data: null }),
    // The bucket stays PRIVATE. A signed URL is a time-limited pass for this one file,
    // so the invoice (with its prices) never has a permanent public link.
    supabase.storage.from(STORAGE_BUCKET).createSignedUrl(doc.file_url, SIGNED_URL_SECONDS),
  ]);

  if (linesRes.error) throw new Error(`Couldn't load the invoice lines: ${linesRes.error.message}`);
  const lines = linesRes.data ?? [];
  const fileUrl = signedRes.data?.signedUrl ?? null;
  const locked = doc.review_status === "confirmed";

  const extraction = extractionPercent(doc);
  const verified = verifiedPercent(doc);
  const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);

  return (
    <div className="min-h-screen p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* ── Left: the original ───────────────────────── */}
        <section className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          {!fileUrl ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Couldn&apos;t open the original file
              {signedRes.error ? `: ${signedRes.error.message}` : "."}
            </p>
          ) : doc.source_format === "pdf" ? (
            <iframe
              src={fileUrl}
              title="Original invoice"
              className="h-[80vh] w-full rounded-lg border border-neutral-200 lg:h-full"
            />
          ) : (
            // Plain <img>, not next/image: a signed URL changes every visit and expires,
            // so there's nothing for Next's image optimiser to cache.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl}
              alt="Original invoice"
              className="max-h-full w-full rounded-lg border border-neutral-200 object-contain"
            />
          )}
        </section>

        {/* ── Right: what the AI read ──────────────────── */}
        <section>
          <header className="mb-4">
            <h1 className="text-xl font-semibold">
              {doc.invoice_number ? `Invoice ${doc.invoice_number}` : "Invoice (no number)"}
              {locked && (
                <span className="ml-3 text-base font-medium text-emerald-700">Confirmed ✓</span>
              )}
            </h1>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-neutral-500">Supplier</dt>
                <dd>
                  {supplierRes.data ? (
                    <Link href={`/suppliers/${doc.supplier_id}`} className="hover:underline">
                      {supplierRes.data.name}
                    </Link>
                  ) : (
                    (doc.supplier_name_raw ?? "Not read")
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Date</dt>
                <dd>{formatDate(doc.invoice_date)}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Delivery charge</dt>
                <dd>
                  {doc.delivery_charge === null ? (
                    <span className="text-amber-700">not read</span>
                  ) : (
                    formatGBP(doc.delivery_charge)
                  )}
                </dd>
              </div>
              {/* Two numbers, deliberately NOT one progress bar (design doc §6):
                  extraction = how well the machine read it ("reshoot?"),
                  verified   = how far the chef has got ("keep going"). */}
              <div>
                <dt className="text-xs text-neutral-500">Extraction</dt>
                <dd>
                  {pct(extraction)}{" "}
                  <span className="text-xs text-neutral-500">
                    ({doc.lines_extracted} of {doc.lines_detected} lines read)
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Verified</dt>
                <dd>
                  {pct(verified)}{" "}
                  <span className="text-xs text-neutral-500">
                    ({doc.lines_verified} of {doc.lines_extracted} confirmed)
                  </span>
                </dd>
              </div>
            </dl>
          </header>

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
              No lines were read from this invoice.
            </p>
          ) : (
            <ReviewLines documentId={doc.id} lines={lines} locked={locked} />
          )}

          {/* Disregarded lines are never hidden (design doc §6) — they're missing spend. */}
          {doc.lines_disregarded > 0 && (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Lines that couldn&apos;t be read: {doc.lines_disregarded}. Check the original — their
              cost isn&apos;t in this invoice yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
