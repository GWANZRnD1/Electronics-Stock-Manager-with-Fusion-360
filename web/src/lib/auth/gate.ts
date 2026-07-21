/** Environment-backed root credential and session cookie name. */
export const GATE_COOKIE = "stock_gate";

export function gateEnabled(): boolean {
  return Boolean(process.env.ACCESS_PIN);
}

/** Constant-time-ish root PIN comparison. Returns true if the gate is disabled. */
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
