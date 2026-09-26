// Dashboard — the "what needs me today?" screen.
//
// Live tiles show real numbers and the WHOLE tile links to where you deal with them.
// Tiles for features that aren't built yet are greyed out and not clickable, with
// honest text about what's missing — never a placeholder number.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadSupplierData } from "@/lib/suppliers/load";
import { latestInvoiceRises } from "@/lib/suppliers/rises";
import { ALERT_TEXT_CLASSES } from "@/lib/format";
import type { DocumentRow } from "@/types/database";

export default async function DashboardPage() {
  const supabase = createClient();

  const [
    {
      data: { user },
    },
    toReviewRes,
    supplierData,
  ] = await Promise.all([
    supabase.auth.getUser(),
    // "To review" = the machine has read it, the chef hasn't signed it off.
    supabase
      .from("documents")
      .select("lines_extracted, lines_verified")
      .eq("document_type", "invoice")
      .eq("processing_status", "extracted")
      .neq("review_status", "confirmed")
      .returns<Pick<DocumentRow, "lines_extracted" | "lines_verified">[]>(),
    loadSupplierData(supabase),
  ]);

  // A failed query must not show "All caught up ✓" — that would be a lie.
  if (toReviewRes.error) {
    throw new Error(`Couldn't load invoices to review: ${toReviewRes.error.message}`);
  }
  const toReview = toReviewRes.data ?? [];
  const linesWaiting = toReview.reduce((n, d) => n + (d.lines_extracted - d.lines_verified), 0);

  // Same function as the /suppliers table, summed across every supplier.
  let red = 0;
  let amber = 0;
  for (const docs of supplierData.docsBySupplier.values()) {
    const counts = latestInvoiceRises(docs, supplierData.linesByDoc);
    red += counts.red;
    amber += counts.amber;
  }

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-neutral-500">Signed in as {user?.email}</p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LiveCard title="Invoices to review" href="/documents">
          {toReview.length === 0 ? (
            <p className="mt-2 text-xl font-semibold text-emerald-700">All caught up ✓</p>
          ) : (
            <>
              <p className="mt-2 text-3xl font-semibold">{toReview.length}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {linesWaiting} {linesWaiting === 1 ? "line" : "lines"} waiting
              </p>
            </>
          )}
        </LiveCard>

        <LiveCard title="Price rises" href="/suppliers">
          {red + amber === 0 ? (
            <p className="mt-2 text-xl font-semibold text-emerald-700">
              No rises on latest deliveries
            </p>
          ) : (
            <>
              <p
                className={`mt-2 text-3xl font-semibold ${
                  red > 0 ? ALERT_TEXT_CLASSES.red : ALERT_TEXT_CLASSES.amber
                }`}
              >
                {red + amber}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {red > 0 && <span className={ALERT_TEXT_CLASSES.red}>{red} red</span>}
                {red > 0 && amber > 0 && " · "}
                {amber > 0 && <span className={ALERT_TEXT_CLASSES.amber}>{amber} amber</span>}
                {" on latest deliveries"}
              </p>
            </>
          )}
        </LiveCard>

        <GreyCard title="Dishes below target GP" note="Set up recipes to see this" />
        <GreyCard title="Ingredients matched" note="Coming with ingredient matching" />
      </section>
    </div>
  );
}

/**
 * Live: the WHOLE tile is the link — one big target, not a tiny text link.
 * `group` lets the arrow react when anywhere on the card is hovered.
 */
function LiveCard({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative block rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
    >
      <h2 className="text-sm font-medium text-neutral-500">{title}</h2>
      {children}
      <span
        aria-hidden
        className="absolute right-4 top-4 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-900"
      >
        →
      </span>
    </Link>
  );
}

/**
 * Not built yet: a plain div — no link, no hover, no pointer cursor, no arrow, so
 * nothing about it invites a click.
 */
function GreyCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-4 text-neutral-400">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-2 text-3xl font-semibold">—</p>
      <p className="mt-1 text-xs">{note}</p>
    </div>
  );
}
