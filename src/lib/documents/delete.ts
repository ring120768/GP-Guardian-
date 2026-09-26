// The "can this document be deleted?" rule, kept pure (no DB, no React) so the API
// route and the card both ask the same question and get the same answer — and so it
// can be unit-tested without a Supabase instance.
//
// The one rule: a CONFIRMED document can't be deleted. Confirmed invoice lines feed
// ingredient costs, which feed recipe costs, which feed GP. Deleting one would
// silently change GP figures the chef has already seen and trusted — exactly the
// "never guess on money" failure the design doc warns about. Anything the chef
// hasn't signed off yet (pending / in_review, including failed extractions) is fair
// game: it hasn't touched the numbers.

import type { DocumentRow } from "@/types/database";

export type DeleteCheck = { allowed: true } | { allowed: false; reason: string };

export function canDeleteDocument(doc: Pick<DocumentRow, "review_status">): DeleteCheck {
  if (doc.review_status === "confirmed") {
    return {
      allowed: false,
      reason:
        "This invoice is confirmed and already feeds your costings — deleting it would change your GP figures.",
    };
  }
  return { allowed: true };
}
