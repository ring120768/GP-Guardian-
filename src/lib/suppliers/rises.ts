// "Did this week's delivery go up?" — price rises on a supplier's LATEST invoice.
//
// Shared by /suppliers (a count per supplier) and the dashboard (the total across all
// suppliers), so the two can never disagree. Older invoices' rises are old news; the
// invoice cards on /documents show those one invoice at a time.
//
// Pure — takes already-loaded data — so it's unit tested (rises.test.ts).

import { comparePrices, alertColour, type PriceLine } from "@/lib/prices/compare";

export interface RiseCounts {
  red: number; // rises over ALERT_THRESHOLD_PCT
  amber: number; // smaller rises
}

/**
 * @param docsNewestFirst the supplier's invoices, newest first (loadSupplierData sorts them)
 * @param linesByDoc      invoice lines grouped by document id
 */
export function latestInvoiceRises(
  docsNewestFirst: { id: string }[],
  linesByDoc: Map<string, PriceLine[]>
): RiseCounts {
  const counts: RiseCounts = { red: 0, amber: 0 };
  const latest = docsNewestFirst[0];
  if (!latest) return counts;

  // Compare the latest invoice against ALL of this supplier's lines — comparePrices
  // itself only looks at strictly earlier dates, so passing everything is safe.
  const supplierLines = docsNewestFirst.flatMap((d) => linesByDoc.get(d.id) ?? []);
  for (const r of comparePrices(linesByDoc.get(latest.id) ?? [], supplierLines)) {
    const colour = alertColour(r);
    if (colour === "red") counts.red += 1;
    if (colour === "amber") counts.amber += 1;
  }
  return counts;
}
