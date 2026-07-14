import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GP Guardian",
  description: "Kitchen intelligence platform — protect your food GP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
