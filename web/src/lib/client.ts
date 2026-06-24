/** Small fetch helpers for client components. Redirect to /unlock on 401. */

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/unlock";
    throw new Error("locked");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export async function jget<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url));
}

async function send<T>(method: string, url: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export function jpost<T>(url: string, body: unknown): Promise<T> {
  return send<T>("POST", url, body);
}

export function jput<T>(url: string, body: unknown): Promise<T> {
  return send<T>("PUT", url, body);
}

export function jpatch<T>(url: string, body: unknown): Promise<T> {
  return send<T>("PATCH", url, body);
}

export async function jdel<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { method: "DELETE" }));
}

/** POST a raw text body (e.g. an uploaded CSV file's contents). */
export async function jpostText<T>(url: string, text: string): Promise<T> {
  return handle<T>(
    await fetch(url, { method: "POST", headers: { "content-type": "text/csv" }, body: text }),
  );
}

/** POST multipart form data (e.g. a board image file). No content-type header —
 * the browser sets the multipart boundary itself. */
export async function jupload<T>(url: string, form: FormData): Promise<T> {
  return handle<T>(await fetch(url, { method: "POST", body: form }));
}
