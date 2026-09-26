// One supplier: the spend summary, every product we've bought from them with its latest
// price movement, and their invoices.
//
// Server component. The [id] folder name makes this a dynamic route — /suppliers/abc
// arrives here with params.id === "abc".

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadSupplierData, linesFor, type SupplierLine } from "@/lib/suppliers/load";
import { summariseSupplier } from "@/lib/suppliers/summary";
import {
  comparePrices,
  alertColour,
  isUncomparable,
  normaliseProductName,
  type PriceComparison,
} from "@/lib/prices/compare";
import { formatGBP, formatDate, formatPct, ALERT_TEXT_CLASSES } from "@/lib/format";
import { DeliveryCell } from "@/components/DeliveryCell";
import type { PriceBasis } from "@/types/database";

const BASIS_LABELS: Record<PriceBasis, string> = {
  per_pack: "per pack",
  per_kg: "per kg",
  per_litre: "per litre",
  per_unit: "per unit",
};

export default async function SupplierPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { suppliers, docsBySupplier, linesByDoc } = await loadSupplierData(supabase);

  const supplier = suppliers.find((s) => s.id === params.id);
  if (!supplier) notFound(); // renders Next's 404 page

  const docs = docsBySupplier.get(supplier.id) ?? []; // newest first
  const allLines = linesFor(docs, linesByDoc);
  const summary = summariseSupplier(docs, allLines);

  // ── Products: one row per normalised name ────────────────
  // "Beef Mince 15% fat" and "BEEF  MINCE 15% FAT" are the same product on paper, so
  // they share a row — same normalisation the price alerts use.
  const byProduct = new Map<string, SupplierLine[]>();
  for (const line of allLines) {
    const key = normaliseProductName(line.product_name_raw);
    byProduct.set(key, [...(byProduct.get(key) ?? []), line]);
  }

  const products = Array.from(byProduct, ([name, lines]) => {
    // Newest first ("" sorts undated lines last). The "latest price" is the newest line
    // we can actually price — a credit or unpriced line isn't what the product costs.
    const newest = [...lines].sort((a, b) =>
      (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "")
    );
    const latest = newest.find((l) => !isUncomparable(l)) ?? newest[0];
    // Same comparison as the invoice cards, so the two screens can never disagree.
    const [comparison] = comparePrices([latest], allLines);
    return {
      name,
      latest,
      comparison,
      invoiceCount: new Set(lines.map((l) => l.document_id)).size,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{supplier.name}</h1>
        <p className="text-sm text-neutral-500">
          Based on unconfirmed invoice lines — figures can change as invoices are reviewed.
        </p>
      </header>

      {/* ── Summary ─────────────────────────────────────── */}
      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Invoices">
          {summary.invoiceCount}
          <span className="block text-xs text-neutral-500">
            {/* One invoice (or all on one day) → one date, not "17/09/2026 – 17/09/2026". */}
            {summary.firstInvoiceDate === summary.lastInvoiceDate
              ? formatDate(summary.firstInvoiceDate)
              : `${formatDate(summary.firstInvoiceDate)} – ${formatDate(summary.lastInvoiceDate)}`}
          </span>
        </Stat>
        <Stat label="Goods (net)">
          {formatGBP(summary.goodsTotal)}
          <span className="block text-xs text-neutral-500">
            {summary.lineCount} lines
            {summary.goodsUnknownCount > 0 && `, ${summary.goodsUnknownCount} unpriced`}
          </span>
        </Stat>
        <Stat label="Delivery charges">
          <DeliveryCell summary={summary} />
        </Stat>
        <Stat label="Other charges">{formatGBP(summary.otherChargesTotal)}</Stat>
      </section>

      {/* ── Products ────────────────────────────────────── */}
      <h2 className="mb-2 text-sm font-medium text-neutral-500">Products ({products.length})</h2>
      <div className="mb-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-4 py-2 text-right font-medium">Latest price</th>
              <th className="px-4 py-2 text-right font-medium">Previous</th>
              <th className="px-4 py-2 font-medium">Change</th>
              <th className="px-4 py-2 text-right font-medium">Invoices</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {products.map(({ name, latest, comparison, invoiceCount }) => (
              <tr key={name}>
                <td className="px-4 py-2">{name}</td>
                <td className="px-4 py-2 text-right">
                  {formatGBP(latest.unit_price)}{" "}
                  <span className="text-xs text-neutral-500">
                    {/* Null basis = the invoice didn't say. Shown as such, not guessed. */}
                    {latest.price_basis ? BASIS_LABELS[latest.price_basis] : "basis not read"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">{formatGBP(comparison.previousPrice)}</td>
                <td className="px-4 py-2">
                  <ChangeCell comparison={comparison} />
                </td>
                <td className="px-4 py-2 text-right">{invoiceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Invoices ────────────────────────────────────── */}
      <h2 className="mb-2 text-sm font-medium text-neutral-500">Invoices ({docs.length})</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 text-right font-medium">Goods (net)</th>
              <th className="px-4 py-2 text-right font-medium">Delivery</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {docs.map((doc) => {
              // Same summary function, one invoice at a time — so these rows add up to
              // the totals at the top of the page.
              const s = summariseSupplier([doc], linesByDoc.get(doc.id) ?? []);
              return (
                <tr key={doc.id}>
                  <td className="px-4 py-2">{doc.invoice_number ?? "No number"}</td>
                  <td className="px-4 py-2">{formatDate(doc.invoice_date)}</td>
                  <td className="px-4 py-2 text-right">
                    {formatGBP(s.goodsTotal)}
                    {s.goodsUnknownCount > 0 && (
                      <span className="block text-xs text-amber-600">
                        + {s.goodsUnknownCount} unpriced
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {doc.delivery_charge === null ? (
                      <span className="text-amber-600">not read</span>
                    ) : (
                      formatGBP(doc.delivery_charge)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="text-xs font-medium text-neutral-500">{label}</h3>
      <div className="mt-1 text-lg font-semibold">{children}</div>
    </div>
  );
}

/** The price movement in words, coloured like the invoice cards. */
function ChangeCell({ comparison: c }: { comparison: PriceComparison }) {
  const colour = alertColour(c);
  switch (c.status) {
    case "up":
    case "down":
      return (
        <span className={colour ? ALERT_TEXT_CLASSES[colour] : ""}>{formatPct(c.changePct!)}</span>
      );
    case "same":
      return <span className="text-neutral-500">no change</span>;
    case "pack_changed":
      return <span className="text-neutral-500">pack size changed</span>;
    case "new":
      return <span className="text-neutral-400">New</span>;
    case "skipped":
      return <span className="text-neutral-400">—</span>;
  }
}
