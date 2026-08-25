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
