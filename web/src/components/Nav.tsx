"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Inventory" },
  { href: "/boards", label: "Boards" },
  { href: "/lookup", label: "Lookup" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-3">
        <span className="mr-3 text-sm font-semibold">Stock Manager</span>
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
