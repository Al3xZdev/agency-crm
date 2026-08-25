/**
 * Same-origin API client for the web app. The Next.js rewrites proxy
 * `/api/*` to the NestJS API so session cookies stay first-party.
 */

/**
 * Cookie name depends on deployment mode: `__Host-csrf` when the API runs
 * with Secure cookies (production), `agency_csrf` otherwise (task 4.6).
 */
const CSRF_COOKIE_CANDIDATES = ['__Host-csrf', 'agency_csrf'] as const;

function readCsrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const name of CSRF_COOKIE_CANDIDATES) {
    const match = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${name}=`));
    if (match) return match.slice(name.length + 1);
  }
  return undefined;
}

/** fetch wrapper that attaches X-CSRF-Token to unsafe methods. */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = readCsrfCookie();
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token);
    }
  }
  return fetch(url, {
    ...init,
    headers,
    credentials: 'same-origin',
    // Magic-link URLs live in page paths; never echo them in Referer.
    referrerPolicy: 'no-referrer',
  });
}

/**
 * JSON helper for staff surfaces: parses the body and turns non-2xx
 * responses into Errors carrying the server's message (e.g. 409
 * CAMPAIGN_NOT_EMPTY) so forms can surface them inline.
 */
export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const message =
      (body as { message?: string } | undefined)?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}
