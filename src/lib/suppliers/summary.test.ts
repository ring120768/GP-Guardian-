// Tests for summariseSupplier(). Run with: npm test
//
// The rules being protected: credits make goods NET, and an unread delivery charge is
// never quietly counted as £0.

import { describe, it, expect } from "vitest";
import { summariseSupplier, type SummaryDocument } from "./summary";

const doc = (o: Partial<SummaryDocument> = {}): SummaryDocument => ({
  invoice_date: "2026-09-01",
  delivery_charge: null,
  other_charges: [],
  ...o,
});

describe("summariseSupplier", () => {
  it("nets a credit line off the goods total", () => {
    const s = summariseSupplier(
      [doc()],
      [{ total_price: 38.75 }, { total_price: 12.5 }, { total_price: -12.5 }]
    );
    expect(s.goodsTotal).toBeCloseTo(38.75, 10);
    expect(s.lineCount).toBe(3);
  });

  it("counts a line with no total as unknown, not £0", () => {
    const s = summariseSupplier([doc()], [{ total_price: 10 }, { total_price: null }]);
    expect(s.goodsTotal).toBe(10);
    expect(s.goodsUnknownCount).toBe(1);
  });

  it("does not treat a null delivery charge as £0", () => {
    const s = summariseSupplier([doc({ delivery_charge: 12 }), doc({ delivery_charge: null })], []);
    expect(s.deliveryTotal).toBe(12);
    expect(s.deliveryUnknownCount).toBe(1);
    expect(s.deliveriesWithCharge).toBe(1);
  });

  it("averages delivery only over invoices where the charge is known", () => {
    const s = summariseSupplier(
      [
        doc({ delivery_charge: 10 }),
        doc({ delivery_charge: 0 }), // known free delivery — counts in the average
        doc({ delivery_charge: null }), // unknown — must NOT drag the average down
      ],
      []
    );
    expect(s.avgDeliveryCharge).toBe(5); // 10 ÷ 2 known, not 10 ÷ 3
    expect(s.deliveriesWithCharge).toBe(1);
  });

  it("sums other charges (discounts negative) and finds the date range", () => {
    const s = summariseSupplier(
      [
        doc({ invoice_date: "2026-09-08", other_charges: [{ label: "Fuel", amount: 3 }] }),
        doc({ invoice_date: "2026-08-25", other_charges: [{ label: "Discount", amount: -1 }] }),
        doc({ invoice_date: null }),
      ],
      []
    );
    expect(s.otherChargesTotal).toBe(2);
    expect(s.firstInvoiceDate).toBe("2026-08-25");
    expect(s.lastInvoiceDate).toBe("2026-09-08");
  });

  it("handles a supplier with no invoices", () => {
    expect(summariseSupplier([], [])).toEqual({
      invoiceCount: 0,
      lineCount: 0,
      goodsTotal: 0,
      goodsUnknownCount: 0,
      deliveryTotal: 0,
      deliveriesWithCharge: 0,
      deliveryUnknownCount: 0,
      avgDeliveryCharge: null,
      otherChargesTotal: 0,
      firstInvoiceDate: null,
      lastInvoiceDate: null,
    });
  });
});
