// Delivery charges for a supplier, used on /suppliers and /suppliers/[id].

import type { SupplierSummary } from "@/lib/suppliers/summary";
import { formatGBP } from "@/lib/format";

/** "£45.00 · avg £7.50 per drop", plus how many invoices' delivery charge wasn't read. */
export function DeliveryCell({ summary: s }: { summary: SupplierSummary }) {
  return (
    <>
      {formatGBP(s.deliveryTotal)}
      {s.avgDeliveryCharge !== null && (
        <span className="text-neutral-500"> · avg {formatGBP(s.avgDeliveryCharge)} per drop</span>
      )}
      {s.deliveryUnknownCount > 0 && (
        <span className="block text-xs text-amber-600">{s.deliveryUnknownCount} not read</span>
      )}
    </>
  );
}
