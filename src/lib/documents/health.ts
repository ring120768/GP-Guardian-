// Document health — turning the raw counters on `documents` into something a chef
// can act on at a glance.
//
// Design doc §6 is emphatic that these are TWO different signals, not one progress bar:
//
//   Extraction %  = lines_extracted / lines_detected
//                   How well the MACHINE read the page. A low number is a
//                   "re-photograph this" signal — reviewing harder won't help,
//                   the source image is the problem.
//
//   Verified %    = lines_verified / lines_extracted
//                   How far the HUMAN has got. This is the normal review-queue metric.
//
// The point of separating them: a chef scanning 10 invoices should be able to glance
// across the batch and know which ones to re-shoot BEFORE starting to review any of
// them — instead of discovering a bad photo three lines into confirming it.

import type { DocumentRow } from "@/types/database";

/**
 * How well the machine read the page. Null when nothing has been detected yet
 * (i.e. extraction hasn't run) — null means "we don't know", NOT 0%. Showing 0%
 * for an un-extracted document would be the system asserting something it hasn't
 * earned. Never guess.
 */
export function extractionPercent(doc: DocumentRow): number | null {
  if (doc.lines_detected === 0) return null;
  return (doc.lines_extracted / doc.lines_detected) * 100;
}

/**
 * How far the chef has got confirming lines. Null when there's nothing extracted
 * to verify yet — again, "unknown", not "zero".
 */
export function verifiedPercent(doc: DocumentRow): number | null {
  if (doc.lines_extracted === 0) return null;
  return (doc.lines_verified / doc.lines_extracted) * 100;
}

/**
 * The single thing we put on the document card. One of these, chosen in priority
 * order — a failed extraction outranks a review nudge, because reviewing a document
 * the machine couldn't read is wasted effort.
 */
export type DocumentHealth =
  | { tone: "waiting"; label: string; detail: string } // nothing needed from anyone yet
  | { tone: "failed"; label: string; detail: string } // machine broke — chef must act
  | { tone: "reshoot"; label: string; detail: string } // read badly — re-photograph it
  | { tone: "review"; label: string; detail: string } // read fine — needs confirming
  | { tone: "done"; label: string; detail: string }; // fully confirmed, nothing to do

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ⬇ THIS ONE'S YOURS, RINGO — it's a chef's judgement call, not a coder's.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything above is mechanical: two divisions and a null check. THIS function is
 * where the product actually gets its opinion, and you've stood over a pass with a
 * pile of creased invoices — I haven't. The trade-offs are real:
 *
 *  • WHERE'S THE RESHOOT LINE? The design doc floats "say, under 70%" for extraction %.
 *    Set it too high and you're nagging a chef to re-photograph a document that only
 *    dropped one line off a 12-line invoice. Set it too low and they waste ten minutes
 *    reviewing a photo that was never going to work. What's the number?
 *
 *  • DOES A BAD-EXTRACTION DOC STILL GET REVIEWED? If extraction is 55% but the chef
 *    has already confirmed all the lines that DID come through — is that "done", or is
 *    it still shouting "reshoot" because 45% of the invoice is missing from your cost
 *    data? (My instinct: still shout. Missing lines means missing spend, and a silently
 *    incomplete invoice is exactly the thing that corrupts GP later. But it's your call
 *    — it might just be annoying.)
 *
 *  • WHAT DOES A CHEF ACTUALLY WANT TO READ at 6pm on a Friday? `detail` is the line
 *    under the badge. "4 of 12 lines confirmed" or "8 lines still to check"? Same fact,
 *    different feel.
 *
 * The four states you're switching on are already there for you:
 *   doc.processing_status → 'uploaded' | 'extracting' | 'extracted' | 'failed'
 *   doc.extraction_error  → the human-readable reason, when it failed
 *   extractionPercent(doc) / verifiedPercent(doc) → number | null
 *   doc.lines_extracted / lines_verified / lines_disregarded → raw counts
 *
 * Roughly 10-15 lines. Return one DocumentHealth. Shout if you want a hand.
 */
export function getDocumentHealth(doc: DocumentRow): DocumentHealth {
  // TODO(Ringo): implement. Delete the placeholder below once you have.
  //
  // Suggested skeleton — priority order matters, first match wins:
  //
  //   if (doc.processing_status === "failed")     → tone: "failed"
  //   if (doc.processing_status === "uploaded")   → tone: "waiting"  ("Queued for reading")
  //   if (doc.processing_status === "extracting") → tone: "waiting"  ("Reading now…")
  //
  //   const extraction = extractionPercent(doc);
  //   const verified   = verifiedPercent(doc);
  //
  //   if (extraction !== null && extraction < YOUR_THRESHOLD) → tone: "reshoot"
  //   if (verified === 100)                                   → tone: "done"
  //   → tone: "review"

  return {
    tone: "waiting",
    label: "Not wired up",
    detail: "getDocumentHealth() hasn't been written yet — see src/lib/documents/health.ts",
  };
}

/** Tailwind classes per tone. Kept next to the type so a new tone can't be forgotten. */
export const HEALTH_STYLES: Record<DocumentHealth["tone"], string> = {
  waiting: "bg-neutral-100 text-neutral-600 border-neutral-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  reshoot: "bg-amber-50 text-amber-800 border-amber-200",
  review: "bg-blue-50 text-blue-700 border-blue-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
