import Link from "next/link";

import { Nav } from "@/components/Nav";

const tools = [
  {
    href: "/locations",
    title: "Locations",
    description: "Manage bins, shelves, project areas, and printable location markers.",
  },
  {
    href: "/lookup",
    title: "Supplier lookup",
    description: "Check live distributor pricing and availability for a manufacturer part number.",
  },
  {
    href: "/library",
    title: "Fusion library",
    description: "Enrich and edit Fusion electronics library attributes.",
  },
  {
    href: "/settings",
    title: "Settings & imports",
    description: "Inventory imports, purchasing rules, distributor sync, and application settings.",
  },
];

export default function MorePage() {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
        <header className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">
            Administration
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">More tools</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Less-frequent setup and purchasing tools live here so everyday stock and assembly work stays uncluttered.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group min-h-32 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">
                    {tool.title}
                  </h2>
                  <p className="mt-2 text-sm leading-5 text-[var(--muted)]">{tool.description}</p>
                </div>
                <span className="text-xl text-blue-700 dark:text-blue-300" aria-hidden>
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
