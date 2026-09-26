import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">GP Guardian</h1>
          <p className="text-sm text-neutral-500">Signed in as {user?.email}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/suppliers"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Suppliers
          </Link>
          <Link
            href="/documents"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Upload invoices
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <h2 className="text-sm font-medium text-neutral-500">Documents needing review</h2>
          <p className="text-3xl font-semibold mt-2">—</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <h2 className="text-sm font-medium text-neutral-500">Dishes below target GP</h2>
          <p className="text-3xl font-semibold mt-2 text-risk">—</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          <h2 className="text-sm font-medium text-neutral-500">Ingredients matched</h2>
          <p className="text-3xl font-semibold mt-2">—</p>
        </div>
      </section>

      <p className="text-sm text-neutral-400 mt-8">
        Foundations are wired: auth, schema, Supabase client, costing logic. Next: document
        upload + AI extraction pipeline.
      </p>
    </div>
  );
}
