// Tests for canDeleteDocument(). Run with: npm test
//
// The rule being protected: confirmed invoices feed costing, so they can't be deleted.
// Everything the chef hasn't signed off yet can be.

import { describe, it, expect } from "vitest";
import { canDeleteDocument } from "./delete";

describe("canDeleteDocument", () => {
  it("allows pending documents", () => {
    expect(canDeleteDocument({ review_status: "pending" })).toEqual({ allowed: true });
  });

  it("allows documents mid-review", () => {
    expect(canDeleteDocument({ review_status: "in_review" })).toEqual({ allowed: true });
  });

  it("allows failed extractions (processing failed, review still pending)", () => {
    // 'failed' lives on processing_status, not review_status — a failed read is
    // always review_status 'pending', so this is the case that covers it.
    const failedDoc = { review_status: "pending" as const, processing_status: "failed" as const };
    expect(canDeleteDocument(failedDoc)).toEqual({ allowed: true });
  });

  it("blocks confirmed documents, with a reason", () => {
    const result = canDeleteDocument({ review_status: "confirmed" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/GP/);
  });
});
