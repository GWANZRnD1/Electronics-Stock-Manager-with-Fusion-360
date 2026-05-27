/**
 * Local (per-browser) autosave for the library editor.
 *
 * Drafts live in localStorage keyed by the uploaded file name, so you can close
 * the tab mid-edit and pick up where you left off — without a server round-trip.
 * The full editing state is stored, baseline included, so the diff-only apply.scr
 * can still be reconstructed after a restore. Storage is per-device, not synced.
 */
import type { LibraryRow } from "@/lib/domain/libraryScr";

const VERSION = "v1";
const KEY_PREFIX = `library-draft:${VERSION}:`;

export interface LibraryDraft {
  fileName: string;
  baseline: LibraryRow[];
  rows: LibraryRow[];
  columns: string[];
  purge: string[];
  overwrite: boolean;
  updatedAt: number; // epoch ms
}

export interface DraftMeta {
  fileName: string;
  updatedAt: number;
  rowCount: number;
}

export type SaveResult = { ok: true } | { ok: false; error: "quota" | "unavailable" };

const keyFor = (fileName: string): string => KEY_PREFIX + encodeURIComponent(fileName);

const hasStorage = (): boolean => typeof window !== "undefined" && Boolean(window.localStorage);

/** Guard our own data on the way back in — it may be corrupt or from an older shape. */
function isDraft(value: unknown): value is LibraryDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.fileName === "string" &&
    typeof d.updatedAt === "number" &&
    typeof d.overwrite === "boolean" &&
    Array.isArray(d.baseline) &&
    Array.isArray(d.rows) &&
    Array.isArray(d.columns) &&
    Array.isArray(d.purge)
  );
}

export function saveDraft(draft: LibraryDraft): SaveResult {
  if (!hasStorage()) return { ok: false, error: "unavailable" };
  try {
    window.localStorage.setItem(keyFor(draft.fileName), JSON.stringify(draft));
    return { ok: true };
  } catch {
    // QuotaExceededError (name varies across browsers) — let the caller surface it.
    return { ok: false, error: "quota" };
  }
}

export function loadDraft(fileName: string): LibraryDraft | null {
  if (!hasStorage()) return null;
  const raw = window.localStorage.getItem(keyFor(fileName));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function deleteDraft(fileName: string): void {
  if (!hasStorage()) return;
  window.localStorage.removeItem(keyFor(fileName));
}

/** Metadata for every stored draft, newest first. */
export function listDrafts(): DraftMeta[] {
  if (!hasStorage()) return [];
  const out: DraftMeta[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(k) ?? "");
      if (isDraft(parsed)) {
        out.push({ fileName: parsed.fileName, updatedAt: parsed.updatedAt, rowCount: parsed.rows.length });
      }
    } catch {
      /* skip a corrupt entry */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function clearAllDrafts(): void {
  if (!hasStorage()) return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
  }
  for (const k of keys) window.localStorage.removeItem(k);
}
