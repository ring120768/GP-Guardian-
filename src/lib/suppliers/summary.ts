// What have we spent with a supplier? One pure function, used by /suppliers (a row per
// supplier) and /suppliers/[id] (the header). Pure, so it's unit tested (summary.test.ts).
//
// Two money rules, both from "never guess on money" (design principle #1):
//
//   1. NULL ≠ £0. A null delivery_charge means the AI didn't read one — not that
//      delivery was free. So unknowns are counted separately (deliveryUnknownCount) and
//      shown, and the average only divides by invoices where we actually know the charge.
//      Same for a line with no total_price (goodsUnknownCount).
//
//   2. Round at DISPLAY, never in the maths. Rounding each line to pennies before adding
//      lets small errors pile up across hundreds of lines; formatGBP() rounds once at the end.

import type { DocumentRow, InvoiceLine } from "@/types/database";

export type SummaryDocument = Pick<
  DocumentRow,
  "invoice_date" | "delivery_charge" | "other_charges"
>;
export type SummaryLine = Pick<InvoiceLine, "total_price">;

export interface SupplierSummary {
  invoiceCount: number;
  lineCount: number;
  /** Sum of line totals. Credits (negative totals) are included, so this is NET spend. */
  goodsTotal: number;
  /** Lines with no total_price — left out of goodsTotal, and counted so we can say so. */
  goodsUnknownCount: number;
  /** Sum of the delivery charges we know about. */
  deliveryTotal: number;
  /** Invoices with a known delivery charge above £0. */
  deliveriesWithCharge: number;
  /** Invoices where the delivery charge wasn't read (null). NOT treated as £0. */
  deliveryUnknownCount: number;
  /** deliveryTotal ÷ invoices with a KNOWN charge (£0 included). Null if none known. */
  avgDeliveryCharge: number | null;
  /** Fuel surcharges, small-order fees etc. Discounts are negative, so this is net too. */
  otherChargesTotal: number;
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
}

export function summariseSupplier(
  documents: SummaryDocument[],
  lines: SummaryLine[]
): SupplierSummary {
  let goodsTotal = 0;
  let goodsUnknownCount = 0;
  for (const line of lines) {
    if (line.total_price === null) goodsUnknownCount += 1;
    else goodsTotal += line.total_price;
  }

  let deliveryTotal = 0;
  let deliveryKnownCount = 0;
  let deliveriesWithCharge = 0;
  let otherChargesTotal = 0;
  let firstInvoiceDate: string | null = null;
  let lastInvoiceDate: string | null = null;

  for (const doc of documents) {
    if (doc.delivery_charge !== null) {
      deliveryTotal += doc.delivery_charge;
      deliveryKnownCount += 1;
      if (doc.delivery_charge > 0) deliveriesWithCharge += 1;
    }

    for (const charge of doc.other_charges ?? []) otherChargesTotal += charge.amount;

    // ISO dates (YYYY-MM-DD) compare correctly as plain strings.
    const d = doc.invoice_date;
    if (d !== null) {
      if (firstInvoiceDate === null || d < firstInvoiceDate) firstInvoiceDate = d;
      if (lastInvoiceDate === null || d > lastInvoiceDate) lastInvoiceDate = d;
    }
  }

  return {
    invoiceCount: documents.length,
    lineCount: lines.length,
    goodsTotal,
    goodsUnknownCount,
    deliveryTotal,
    deliveriesWithCharge,
    deliveryUnknownCount: documents.length - deliveryKnownCount,
    avgDeliveryCharge: deliveryKnownCount > 0 ? deliveryTotal / deliveryKnownCount : null,
    otherChargesTotal,
    firstInvoiceDate,
    lastInvoiceDate,
  };
}
