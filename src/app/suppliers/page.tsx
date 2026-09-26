// Suppliers screen — one row per supplier: what we've spent, what delivery costs, and
// whether their latest invoice put prices up.
//
// Server component, no API route: the data is loaded and summarised on the server, and
// the page is plain HTML with links. Nothing here is interactive.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadSupplierData, linesFor } from "@/lib/suppliers/load";
import { summariseSupplier } from "@/lib/suppliers/summary";
import { comparePrices, alertColour } from "@/lib/prices/compare";
import { formatGBP, formatDate, ALERT_TEXT_CLASSES } from "@/lib/format";
import { DeliveryCell } from "@/components/DeliveryCell";

export default async function SuppliersPage() {
  const supabase = createClient();
  const { suppliers, docsBySupplier, linesByDoc, unlinkedInvoiceCount } =
    await loadSupplierData(supabase);

  const rows = suppliers
    .map((supplier) => {
      const docs = docsBySupplier.get(supplier.id) ?? []; // newest first
      const allLines = linesFor(docs, linesByDoc);
      const summary = summariseSupplier(docs, allLines);

      // Price rises on their LATEST invoice only — "did this week's delivery go up?".
      // Older invoices' rises are old news; the documents page shows those per card.
      let red = 0;
      let amber = 0;
      const latest = docs[0];
      if (latest) {
        for (const r of comparePrices(linesByDoc.get(latest.id) ?? [], allLines)) {
          const colour = alertColour(r);
          if (colour === "red") red += 1;
          if (colour === "amber") amber += 1;
        }
      }

      return { supplier, summary, red, amber };
    })
    .sort((a, b) => b.summary.goodsTotal - a.summary.goodsTotal);

  const totals = rows.reduce(
    (t, { summary: s }) => ({
      invoices: t.invoices + s.invoiceCount,
      goods: t.goods + s.goodsTotal,
      delivery: t.delivery + s.deliveryTotal,
      deliveryUnknown: t.deliveryUnknown + s.deliveryUnknownCount,
    }),
    { invoices: 0, goods: 0, delivery: 0, deliveryUnknown: 0 }
  );

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <p className="text-sm">
          <Link href="/" className="text-neutral-500 hover:underline">
            ← Dashboard
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Suppliers</h1>
        <p className="text-sm text-neutral-500">
          Based on unconfirmed invoice lines — figures can change as invoices are reviewed.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
          No suppliers yet. They&apos;re added automatically when an invoice is read.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="px-4 py-2 text-right font-medium">Invoices</th>
                <th className="px-4 py-2 text-right font-medium">Goods (net)</th>
                <th className="px-4 py-2 font-medium">Delivery charges</th>
                <th className="px-4 py-2 font-medium">Price rises (latest invoice)</th>
                <th className="px-4 py-2 font-medium">Last delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map(({ supplier, summary: s, red, amber }) => (
                <tr key={supplier.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/suppliers/${supplier.id}`}
                      className="font-medium hover:underline"
                    >
                      {supplier.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right">{s.invoiceCount}</td>
                  <td className="px-4 py-2 text-right">
                    {formatGBP(s.goodsTotal)}
                    {s.goodsUnknownCount > 0 && (
                      <span className="block text-xs text-amber-600">
                        + {s.goodsUnknownCount} unpriced{" "}
                        {s.goodsUnknownCount === 1 ? "line" : "lines"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <DeliveryCell summary={s} />
                  </td>
                  <td className="px-4 py-2">
                    {red === 0 && amber === 0 ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <>
                        {red > 0 && <span className={ALERT_TEXT_CLASSES.red}>{red} red</span>}
                        {red > 0 && amber > 0 && " · "}
                        {amber > 0 && (
                          <span className={ALERT_TEXT_CLASSES.amber}>{amber} amber</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2">{formatDate(s.lastInvoiceDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-sm text-neutral-600">
        {totals.invoices} {totals.invoices === 1 ? "invoice" : "invoices"} ·{" "}
        {formatGBP(totals.goods)} goods (net) · {formatGBP(totals.delivery)} delivery
        {totals.deliveryUnknown > 0 && ` (${totals.deliveryUnknown} not read)`}
      </p>
      {unlinkedInvoiceCount > 0 && (
        // Honest about what's NOT in the totals above, rather than silently leaving it out.
        <p className="mt-1 text-xs text-neutral-400">
          {unlinkedInvoiceCount} {unlinkedInvoiceCount === 1 ? "invoice has" : "invoices have"} no
          supplier linked and {unlinkedInvoiceCount === 1 ? "isn't" : "aren't"} included.
        </p>
      )}
    </div>
  );
}
