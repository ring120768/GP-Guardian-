// One row in the documents list. Renders the health badge from getDocumentHealth()
// (§6's two-signal logic) — so the moment Ringo fills that function in, every card
// starts telling the truth about whether a document needs re-shooting, reviewing,
// or nothing at all.

import type { DocumentRow } from "@/types/database";
import { getDocumentHealth, HEALTH_STYLES } from "@/lib/documents/health";
import { ExtractButton } from "@/components/ExtractButton";
import { DeleteDocumentButton } from "@/components/DeleteDocumentButton";
import { canDeleteDocument } from "@/lib/documents/delete";

export function DocumentCard({ doc }: { doc: DocumentRow }) {
  const health = getDocumentHealth(doc);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-800">
          {doc.invoice_number ? `Invoice ${doc.invoice_number}` : "Untitled document"}
          <span className="ml-2 text-xs font-normal uppercase tracking-wide text-neutral-400">
            {doc.source_format}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {doc.invoice_date ?? new Date(doc.created_at).toLocaleDateString("en-GB")}
          {" · "}
          {health.detail}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* 'Read invoice' / retry — only renders while the machine hasn't read it yet. */}
        <ExtractButton documentId={doc.id} processingStatus={doc.processing_status} />
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
            HEALTH_STYLES[health.tone]
          }`}
        >
          {health.label}
        </span>
        {/* Confirmed invoices feed costing, so they get no Delete at all — the API
            refuses them too (same canDeleteDocument() rule on both sides).
            lines_extracted = rows actually saved to invoice_lines, i.e. what the
            cascade will remove. */}
        {canDeleteDocument(doc).allowed && (
          <DeleteDocumentButton documentId={doc.id} lineCount={doc.lines_extracted} />
        )}
      </div>
    </div>
  );
}
