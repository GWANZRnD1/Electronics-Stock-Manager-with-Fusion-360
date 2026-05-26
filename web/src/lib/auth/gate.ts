/**
 * Simple shared-PIN access gate (not real user auth — just keeps strangers out).
 *
 * The unlock route verifies the submitted PIN against ACCESS_PIN and sets an
 * httpOnly cookie holding a token derived from the PIN. The proxy recomputes the
 * same token and compares — so a forged cookie can't pass without knowing the PIN.
 * If ACCESS_PIN is unset, the gate is disabled (handy for local dev).
 *
 * Uses Web Crypto so it works in both the Edge (proxy) and Node (route) runtimes.
 */
export const GATE_COOKIE = "stock_gate";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function gateEnabled(): boolean {
  return Boolean(process.env.ACCESS_PIN);
}

/** The cookie value expected for an unlocked session, or null if the gate is off. */
export async function expectedToken(): Promise<string | null> {
  const pin = process.env.ACCESS_PIN;
  if (!pin) return null;
  return sha256Hex(`stock-gate:v1:${pin}`);
}

/** Constant-time-ish PIN comparison. Returns true if the gate is disabled. */
export function checkPin(submitted: string): boolean {
  const pin = process.env.ACCESS_PIN ?? "";
  if (!pin) return true;
  if (submitted.length !== pin.length) return false;
  let diff = 0;
  for (let i = 0; i < pin.length; i++) {
    diff |= submitted.charCodeAt(i) ^ pin.charCodeAt(i);
  }
  return diff === 0;
}
