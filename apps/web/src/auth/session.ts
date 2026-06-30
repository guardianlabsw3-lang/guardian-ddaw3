/**
 * Admin session persistence. The JWT is held in `localStorage` so the panel survives a
 * reload; it is sent only as a Bearer header to the API (never logged or exposed in URLs).
 * Browser-only.
 */
const STORAGE_KEY = 'payorder.admin.token';

export function loadToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function saveToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** A best-effort idempotency key for create-order requests (RFC 4122 when available). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
