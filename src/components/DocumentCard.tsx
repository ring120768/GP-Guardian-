// One row in the documents list. Renders the health badge from getDocumentHealth()
// (§6's two-signal logic) — so the moment Ringo fills that function in, every card
// starts telling the truth about whether a document needs re-shooting, reviewing,
// or nothing at all.

import type { DocumentRow } from "@/types/database";
import { getDocumentHealth, HEALTH_STYLES } from "@/lib/documents/health";

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

      <span
        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
          HEALTH_STYLES[health.tone]
        }`}
      >
        {health.label}
      </span>
    </div>
  );
}
