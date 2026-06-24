/**
 * Minimal Supabase Storage client over the REST API — no SDK dependency.
 *
 * Board images are stored in a private bucket; uploads and reads both use the
 * SERVICE ROLE key (server-side only — never exposed to the browser). The app
 * proxies reads through /api/boards/[id]/image so images stay behind the PIN
 * gate rather than being publicly served.
 *
 * Env:
 *   SUPABASE_SECRET_KEY        (required) — a Supabase "Secret key" (sb_secret_…)
 *                              from Project Settings → API Keys. The legacy
 *                              SUPABASE_SERVICE_ROLE_KEY (service_role JWT) is
 *                              still accepted as a fallback.
 *   SUPABASE_URL               (optional) — https://<ref>.supabase.co. If unset
 *                              it is derived from the project ref in DATABASE_URL
 *                              (the "postgres.<ref>" username of the pooler URL).
 */

export const BOARD_IMAGES_BUCKET = "board-images";

/** Derive https://<ref>.supabase.co from DATABASE_URL's "postgres.<ref>" user. */
function deriveProjectUrl(): string | null {
  const db = process.env.DATABASE_URL;
  if (!db) return null;
  // postgresql://postgres.<ref>:<pw>@<host>:<port>/postgres
  const m = db.match(/\/\/postgres\.([a-z0-9]+):/i);
  return m ? `https://${m[1]}.supabase.co` : null;
}

function projectUrl(): string {
  const url = process.env.SUPABASE_URL || deriveProjectUrl();
  if (!url) {
    throw new Error("SUPABASE_URL is not set and could not be derived from DATABASE_URL");
  }
  return url.replace(/\/$/, "");
}

/** New "Secret key" (sb_secret_…), falling back to the legacy service_role JWT. */
function secretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function serviceKey(): string {
  const key = secretKey();
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set — add a Supabase Secret key (sb_secret_…) to web/.env.local (and Vercel) to enable board-image upload/serve.",
    );
  }
  return key;
}

/** True when the storage env is configured (used to gate the UI gracefully). */
export function storageConfigured(): boolean {
  return Boolean(secretKey() && (process.env.SUPABASE_URL || deriveProjectUrl()));
}

function authHeaders(): Record<string, string> {
  const key = serviceKey();
  return { authorization: `Bearer ${key}`, apikey: key };
}

/** Create the bucket if it doesn't exist (idempotent). Private by default. */
export async function ensureBucket(): Promise<void> {
  const base = `${projectUrl()}/storage/v1`;
  const head = await fetch(`${base}/bucket/${BOARD_IMAGES_BUCKET}`, { headers: authHeaders() });
  if (head.ok) return;
  const res = await fetch(`${base}/bucket`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      id: BOARD_IMAGES_BUCKET,
      name: BOARD_IMAGES_BUCKET,
      public: false,
      file_size_limit: 10 * 1024 * 1024, // 10 MB per image is plenty for a PCB render
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`failed to create storage bucket (${res.status}): ${await res.text()}`);
  }
}

/** Upload (overwriting) an object. Ensures the bucket exists first. */
export async function uploadObject(
  path: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  const res = await fetch(`${projectUrl()}/storage/v1/object/${BOARD_IMAGES_BUCKET}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": contentType, "x-upsert": "true" },
    body: body as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`storage upload failed (${res.status}): ${await res.text()}`);
  }
}

/** Download an object's bytes (private bucket — uses the service key). */
export async function downloadObject(
  path: string,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const res = await fetch(`${projectUrl()}/storage/v1/object/${BOARD_IMAGES_BUCKET}/${path}`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`storage download failed (${res.status}): ${await res.text()}`);
  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Remove an object (best-effort; ignores 404). */
export async function removeObject(path: string): Promise<void> {
  const res = await fetch(`${projectUrl()}/storage/v1/object/${BOARD_IMAGES_BUCKET}/${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`storage delete failed (${res.status}): ${await res.text()}`);
  }
}
