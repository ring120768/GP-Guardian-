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

// `exact`: only highlight on that exact URL. "/" would otherwise match everything, and
// "/ingredients" would light up on "/ingredients/match" alongside Match ingredients.
const LINKS = [
  { href: "/", label: "Dashboard", exact: true },
  // URL stays /documents (recipes and menus will be documents too); the chef sees "Invoices".
  { href: "/documents", label: "Invoices", exact: false },
  { href: "/suppliers", label: "Suppliers", exact: false },
  { href: "/ingredients", label: "Ingredients", exact: true },
  { href: "/ingredients/match", label: "Match ingredients", exact: true, badge: true },
];

function isActive(pathname: string, href: string, exact: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * @param matchCount products waiting in the Match ingredients queue — loaded by the
 *   layout. Null if it couldn't be loaded: then no badge, rather than a wrong "0".
 */
export function NavBar({ matchCount }: { matchCount: number | null }) {
  const pathname = usePathname();
  if (pathname.startsWith("/login")) return null;

  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="flex items-center gap-6 px-8 py-3">
        <Link href="/" className="font-semibold">
          GP Guardian
        </Link>
        <ul className="flex gap-1 text-sm">
          {LINKS.map(({ href, label, exact, badge }) => {
            const active = isActive(pathname, href, exact);
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
                  {badge && matchCount !== null && matchCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                      {matchCount}
                    </span>
                  )}
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
