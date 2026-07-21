"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { jget } from "@/lib/client";

const LINKS = [
  { href: "/", label: "Inventory", icon: "inventory" },
  { href: "/stocktake", label: "Stocktake", icon: "stocktake" },
  { href: "/boards", label: "Assemble", icon: "assemble" },
  { href: "/scan", label: "Receive", icon: "receive" },
  { href: "/more", label: "More", icon: "more" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/more") {
    return ["/more", "/locations", "/lookup", "/library", "/settings"].some((path) =>
      pathname.startsWith(path),
    );
  }
  return pathname.startsWith(href);
}

function NavIcon({ name }: { name: (typeof LINKS)[number]["icon"] }) {
  const common = "h-5 w-5";
  if (name === "inventory") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M4 5.5h16v13H4zM4 10h16M9 10v8.5" />
      </svg>
    );
  }
  if (name === "stocktake") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M8 4h8M9 3v3m6-3v3M6 5h12v15H6zM9 11l2 2 4-4M9 17h6" />
      </svg>
    );
  }
  if (name === "assemble") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <circle cx="15" cy="14" r="1.5" />
        <path d="M10.5 10h4M9 11.5v3" />
      </svg>
    );
  }
  if (name === "receive") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M5 4v5M5 15v5M19 4v5M19 15v5M3 7h4M3 17h4M17 7h4M17 17h4M9 12h6M12 9v6" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string; isRoot: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void jget<{ user: { name: string; isRoot: boolean } }>("/api/auth/session")
      .then((result) => active && setUser(result.user))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:h-16 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-700 text-xs font-bold text-white dark:bg-blue-400 dark:text-slate-950">
              EC
            </span>
            <span>Stock Manager</span>
          </Link>
          <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 sm:flex">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                    active
                      ? "bg-blue-700 text-white dark:bg-blue-400 dark:text-slate-950"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  }`}
                >
                  <NavIcon name={link.icon} />
                  {link.label}
                </Link>
              );
            })}
          </nav>
          {user && (
            <Link
              href="/settings"
              className="ml-2 hidden min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 text-sm hover:bg-[var(--surface-subtle)] sm:flex"
              aria-label={`Signed in as ${user.name}`}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-bold uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                {user.name.slice(0, 1)}
              </span>
              <span className="max-w-24 truncate">{user.name}</span>
            </Link>
          )}
        </div>
      </header>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/97 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden"
      >
        <div className="grid grid-cols-5">
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium ${
                  active ? "text-blue-700 dark:text-blue-300" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <span
                  className={`grid h-8 w-10 place-items-center rounded-full ${
                    active ? "bg-blue-100 dark:bg-blue-500/20" : ""
                  }`}
                >
                  <NavIcon name={link.icon} />
                </span>
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
