import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import { createClient } from "@/lib/supabase/server";
import { loadMatchQueue } from "@/lib/matching/loadQueue";

export const metadata: Metadata = {
  title: "GP Guardian",
  description: "Kitchen intelligence platform — protect your food GP.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nav badge: how many products are waiting to be matched. Loaded here (not in the
  // NavBar) because the NavBar is a client component and this needs the database.
  // Layouts don't re-render on every client-side navigation, but router.refresh() —
  // which matching and extraction both call — does refresh them, so the badge keeps up.
  let matchCount: number | null = null;
  try {
    matchCount = (await loadMatchQueue(createClient())).length;
  } catch {
    matchCount = null; // no badge beats a wrong one; the page itself will show the error
  }

  return (
    <html lang="en">
      <body>
        {/* Hides itself on /login — see NavBar.tsx */}
        <NavBar matchCount={matchCount} />
        {children}
      </body>
    </html>
  );
}
