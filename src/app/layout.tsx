import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "GP Guardian",
  description: "Kitchen intelligence platform — protect your food GP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Hides itself on /login — see NavBar.tsx */}
        <NavBar />
        {children}
      </body>
    </html>
  );
}
