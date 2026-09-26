// One row in the documents list. Renders the health badge from getDocumentHealth()
// (§6's two-signal logic) — so the moment Ringo fills that function in, every card
// starts telling the truth about whether a document needs re-shooting, reviewing,
// or nothing at all.
//
// Client component only so it can hide itself the instant a delete succeeds
// (before router.refresh() comes back). Everything it imports is pure.

"use client";

import { useState } from "react";
import type { DocumentRow } from "@/types/database";
import { getDocumentHealth, HEALTH_STYLES } from "@/lib/documents/health";
import { ExtractButton } from "@/components/ExtractButton";
import { DeleteDocumentButton } from "@/components/DeleteDocumentButton";
import { canDeleteDocument } from "@/lib/documents/delete";
import { alertColour, type PriceComparison } from "@/lib/prices/compare";

const COLOUR_CLASSES = {
  red: "text-red-600",
  amber: "text-amber-600",
  green: "text-green-700",
} as const;

const gbp = (n: number | null) => (n === null ? "—" : `£${n.toFixed(2)}`);

export function DocumentCard({
  doc,
  priceChanges,
}: {
  doc: DocumentRow;
  /** Already filtered to up / down / pack_changed by the page. */
  priceChanges: PriceComparison[];
}) {
  const [deleted, setDeleted] = useState(false);
  if (deleted) return null;

  const health = getDocumentHealth(doc);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-4">
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
            <DeleteDocumentButton
              documentId={doc.id}
              lineCount={doc.lines_extracted}
              onDeleted={() => setDeleted(true)}
            />
          )}
        </div>
      </div>

      {priceChanges.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-2">
          {/* Nothing on this card is confirmed yet — the prices came straight off the
              AI read. Saying so stops a misread price looking like a real rise. */}
          <p className="text-xs font-medium text-neutral-500">
            Price changes vs last invoice{" "}
            <span className="font-normal text-neutral-400">(from unconfirmed lines)</span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {priceChanges.map((r, i) => {
              const colour = alertColour(r);
              return (
                <li
                  key={i}
                  className={`text-xs ${colour ? COLOUR_CLASSES[colour] : "text-neutral-500"}`}
                  title={`Last invoice: ${r.previousInvoiceNumber ?? "no number"}, ${r.previousDate}`}
                >
                  {r.productName} {gbp(r.previousPrice)} → {gbp(r.currentPrice)}{" "}
                  {r.status === "pack_changed"
                    ? "pack size changed"
                    : `${r.changePct! > 0 ? "+" : ""}${r.changePct!.toFixed(1)}%`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
