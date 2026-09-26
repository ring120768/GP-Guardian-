// The "Match ingredients" queue: every invoice line with no ingredient yet, grouped so
// each PRODUCT is asked about once (design doc §5.3).
//
// "CHIX SUP 150-175G" on 12 invoices = ONE question, and the answer is applied to all
// 12 lines. The group key is (supplier, matchText(name)) — the same key the alias is
// written under, so answering a row is exactly what makes it auto-match next time.
//
// Pure — unit tested in queue.test.ts. The DB loading is in loadQueue.ts.

import type { InvoiceLine } from "@/types/database";
import { matchText } from "./match";

export type QueueLine = Pick<
  InvoiceLine,
  | "id"
  | "supplier_id"
  | "product_name_raw"
  | "unit_price"
  | "price_basis"
  | "invoice_date"
  | "created_at"
>;

export interface QueueRow {
  /** Stable React key: supplier + matched text. */
  key: string;
  supplierId: string | null;
  /** matchText() of the product name — what the alias will be saved as. */
  matchName: string;
  /** The name as printed on the NEWEST invoice, for display. */
  rawName: string;
  lineCount: number;
  /** The newest line, for "latest price". */
  latest: QueueLine;
}

export const queueKey = (supplierId: string | null, raw: string) =>
  `${supplierId ?? "none"}|${matchText(raw)}`;

/** Newest invoice first; lines with no invoice date go last. */
function newestFirst(a: QueueLine, b: QueueLine): number {
  if (a.invoice_date !== b.invoice_date) {
    if (a.invoice_date === null) return 1;
    if (b.invoice_date === null) return -1;
    return a.invoice_date < b.invoice_date ? 1 : -1;
  }
  return a.created_at < b.created_at ? 1 : -1;
}

/**
 * One row per (supplier, product). Biggest groups first — answering those clears the
 * most lines per click.
 */
export function groupUnmatched(lines: QueueLine[]): QueueRow[] {
  const groups = new Map<string, QueueLine[]>();
  for (const line of lines) {
    const key = queueKey(line.supplier_id, line.product_name_raw);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  return Array.from(groups, ([key, group]) => {
    const latest = [...group].sort(newestFirst)[0];
    return {
      key,
      supplierId: latest.supplier_id,
      matchName: matchText(latest.product_name_raw),
      rawName: latest.product_name_raw,
      lineCount: group.length,
      latest,
    };
  }).sort((a, b) => b.lineCount - a.lineCount || a.matchName.localeCompare(b.matchName));
}
