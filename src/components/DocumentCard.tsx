// One row in the documents list. Renders the health badge from getDocumentHealth()
// (§6's two-signal logic) — so the moment Ringo fills that function in, every card
// starts telling the truth about whether a document needs re-shooting, reviewing,
// or nothing at all.
//
// Client component only so it can hide itself the instant a delete succeeds
// (before router.refresh() comes back). Everything it imports is pure.

"use client";

import { useState } from "react";
import Link from "next/link";
import type { DocumentRow } from "@/types/database";
import { getDocumentHealth, HEALTH_STYLES } from "@/lib/documents/health";
import { ExtractButton } from "@/components/ExtractButton";
import { DeleteDocumentButton } from "@/components/DeleteDocumentButton";
import { canDeleteDocument } from "@/lib/documents/delete";
import { alertColour, type PriceComparison } from "@/lib/prices/compare";
import { formatGBP, formatPct, ALERT_TEXT_CLASSES } from "@/lib/format";

export function DocumentCard({
  doc,
  supplierName,
  priceChanges,
}: {
  doc: DocumentRow;
  /** The linked supplier's name, or null if no supplier is linked yet. */
  supplierName: string | null;
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
            {doc.invoice_number ? `Invoice ${doc.invoice_number}` : "Untitled invoice"}
            <span className="ml-2 text-xs font-normal uppercase tracking-wide text-neutral-400">
              {doc.source_format}
            </span>
          </p>
          {doc.supplier_id && supplierName && (
            <p className="text-xs">
              <Link href={`/suppliers/${doc.supplier_id}`} className="text-neutral-700 hover:underline">
                {supplierName}
              </Link>
            </p>
          )}
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
          {doc.review_status === "confirmed" && (
            <span className="text-xs font-medium text-emerald-700">Confirmed ✓</span>
          )}
          {/* Only once the machine has read it — before that there's nothing to review. */}
          {doc.processing_status === "extracted" && (
            <Link
              href={`/documents/${doc.id}/review`}
              className="text-xs font-medium text-neutral-700 hover:underline"
            >
              Review
            </Link>
          )}
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
            <span className="font-normal text-neutral-400">
              {doc.review_status === "confirmed"
                ? "(from confirmed lines)"
                : "(from unconfirmed lines)"}
            </span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {priceChanges.map((r, i) => {
              const colour = alertColour(r);
              return (
                <li
                  key={i}
                  className={`text-xs ${colour ? ALERT_TEXT_CLASSES[colour] : "text-neutral-500"}`}
                  title={`Last invoice: ${r.previousInvoiceNumber ?? "no number"}, ${r.previousDate}`}
                >
                  {r.productName} {formatGBP(r.previousPrice)} → {formatGBP(r.currentPrice)}{" "}
                  {r.status === "pack_changed"
                    ? "pack size changed"
                    : formatPct(r.changePct!)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
