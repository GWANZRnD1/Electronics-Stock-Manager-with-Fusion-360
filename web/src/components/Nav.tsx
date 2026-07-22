"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { jget } from "@/lib/client";
import { isKeyboardInput } from "@/lib/keyboard";

import { Modal } from "./ui";

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
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; isRoot: boolean } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void jget<{ user: { name: string; isRoot: boolean } }>("/api/auth/session")
      .then((result) => active && setUser(result.user))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && shortcutsOpen) {
        event.preventDefault();
        setShortcutsOpen(false);
        return;
      }

      const inInput = isKeyboardInput(event.target);
      const dialogOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));

      if (event.key === "?" && !inInput && !dialogOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (event.key === "/" && !inInput && !dialogOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const search = document.querySelector<HTMLElement>("[data-shortcut-search]:not([disabled])");
        if (search) {
          event.preventDefault();
          search.focus();
          if (search instanceof HTMLInputElement) search.select();
        }
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !inInput && !dialogOpen) {
        const index = Number(event.key) - 1;
        const destination = LINKS[index];
        if (destination) {
          event.preventDefault();
          router.push(destination.href);
        }
        return;
      }

      if (event.key === "Escape" && inInput) {
        (event.target as HTMLElement).blur();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, shortcutsOpen]);

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
            {LINKS.map((link, index) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  aria-keyshortcuts={`Alt+${index + 1}`}
                  title={`${link.label} (Alt+${index + 1})`}
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
          <button
            type="button"
            className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[var(--border)] text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface-subtle)] sm:ml-2"
            onClick={() => setShortcutsOpen(true)}
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="?"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
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
          {LINKS.map((link, index) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                aria-keyshortcuts={`Alt+${index + 1}`}
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

      {shortcutsOpen && (
        <ShortcutHelp pathname={pathname} onClose={() => setShortcutsOpen(false)} />
      )}
    </>
  );
}

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 font-mono text-xs font-semibold shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2.5 last:border-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key) => <Keycap key={key}>{key}</Keycap>)}
      </span>
    </div>
  );
}

function ShortcutHelp({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const assembly = /^\/boards\/[^/]+\/view/.test(pathname);
  const stocktake = pathname.startsWith("/stocktake");
  const inventory = pathname === "/";

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="space-y-4">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Anywhere</h3>
          <div className="mt-1">
            <ShortcutRow keys={["/"]} label="Focus this page's search or filter" />
            <ShortcutRow keys={["Alt", "1–5"]} label="Switch primary section" />
            <ShortcutRow keys={["Esc"]} label="Close, cancel, or clear the current action" />
            <ShortcutRow keys={["?"]} label="Show this shortcut guide" />
          </div>
        </section>

        {assembly && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Assembly view</h3>
            <div className="mt-1">
              <ShortcutRow keys={["J", "K"]} label="Select next or previous BOM line" />
              <ShortcutRow keys={["Space"]} label="Toggle selected line populated" />
              <ShortcutRow keys={["T", "B"]} label="Show top or bottom of board" />
              <ShortcutRow keys={["S"]} label="Scan a component" />
              <ShortcutRow keys={["+", "−"]} label="Zoom the board image" />
              <ShortcutRow keys={["0"]} label="Fit the board image" />
            </div>
          </section>
        )}

        {stocktake && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Stocktake</h3>
            <div className="mt-1">
              <ShortcutRow keys={["Enter"]} label="Confirm count and move to the next row" />
              <ShortcutRow keys={["Esc"]} label="Restore the active row's expected count" />
              <ShortcutRow keys={["Ctrl/⌘", "Enter"]} label="Save all checked counts" />
            </div>
          </section>
        )}

        {inventory && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Inventory table</h3>
            <div className="mt-1">
              <ShortcutRow keys={["Double-click"]} label="Edit a catalog cell or location count" />
              <ShortcutRow keys={["Enter"]} label="Save an inline edit" />
              <ShortcutRow keys={["Esc"]} label="Cancel an inline edit" />
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
