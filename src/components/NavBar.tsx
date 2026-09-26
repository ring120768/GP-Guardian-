"use client";

// The top bar on every signed-in page.
//
// Client component only because it needs usePathname() to highlight the current page.
//
// "Signed-in pages" = everything except /login: the middleware already sends signed-out
// users to /login, so if we're anywhere else, someone is signed in. That saves an auth
// round trip in the layout on every page load.

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  // URL stays /documents (recipes and menus will be documents too); the chef sees "Invoices".
  { href: "/documents", label: "Invoices" },
  { href: "/suppliers", label: "Suppliers" },
];

/** "/" only matches exactly; the others also match their sub-pages (/suppliers/abc). */
function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname();
  if (pathname.startsWith("/login")) return null;

  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="flex items-center gap-6 px-8 py-3">
        <Link href="/" className="font-semibold">
          GP Guardian
        </Link>
        <ul className="flex gap-1 text-sm">
          {LINKS.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 ${
                    active
                      ? "bg-neutral-100 font-medium text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <Link
          href="/documents#upload"
          className="ml-auto rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Upload
        </Link>
      </div>
    </nav>
  );
}
