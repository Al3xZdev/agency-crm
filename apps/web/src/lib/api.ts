'use client';

/**
 * API client for the staff + client surfaces.
 *
 * All calls go through the Next.js rewrite proxy (same-origin `/api/*`),
 * which forwards to INTERNAL_API_URL. `credentials: 'same-origin'` makes the
 * session cookie ride along. A CSRF cookie (either `__Host-csrf` or
 * `agency_csrf`) is echoed back as a header on state-changing requests, per
 * the backend's CSRF guard.
 *
 * JSON parsing happens here — callers get typed data and only see
 * `ApiError` on failure. Legacy pages keep using `apiJson`, the thin
 * RequestInit-compatible wrapper, until their PR replaces them.
 */

export class ApiError extends Error {
  status: number;
  fieldErrors: Record<string, string> | null;

  constructor(message: string, status: number, fieldErrors: Record<string, string> | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

interface ApiErrorPayload {
  message?: string;
  fieldErrors?: Record<string, string> | null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** The CSRF token from `__Host-csrf` or `agency_csrf`, if present. */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)(__Host-csrf|agency_csrf)=([^;]+)/);
  const token = match?.[2];
  return token ? decodeURIComponent(token) : null;
}

/** The token persisted as `agency_session` on the session cookie. */
export function getSessionToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)agency_session=([^;]+)/);
  const token = match?.[1];
  return token ? decodeURIComponent(token) : null;
}

function shouldRedirectToLogin(): boolean {
  const { pathname } = window.location;
  // Staff surfaces bounce to /login on 401. The login page itself and the
  // client portal (/c/*) must NOT bounce — the client portal has its own
  // session flow and errors render inline there instead.
  return !pathname.startsWith('/login') && !pathname.startsWith('/c');
}

function isJsonBody(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return false;
  if (
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof ReadableStream ||
    ArrayBuffer.isView(value)
  ) {
    return false;
  }
  return true;
}

function toBody(value: unknown): BodyInit | undefined {
  if (value === undefined || value === null) return undefined;
  return value as BodyInit;
}

async function readPayload(res: Response): Promise<ApiErrorPayload | null> {
  try {
    return (await res.json()) as ApiErrorPayload;
  } catch {
    return null;
  }
}

/**
 * Reference-style fetch: takes a path, a JSON-serializable `body` (or a
 * string/FormData passthrough for legacy/upload callers), and returns the
 * parsed JSON. Throws `ApiError` on non-2xx; a 401 outside `/login` and
 * `/c/*` redirects to the staff login.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers = {} } = options;

  const requestHeaders: Record<string, string> = { ...headers };
  const jsonBody = isJsonBody(body);
  if (jsonBody) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const token = csrfToken();
  if (token != null) {
    requestHeaders['X-CSRF-Token'] = token;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : toBody(jsonBody ? JSON.stringify(body) : body),
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('No pudimos conectarnos con el servidor.', 0);
  }

  if (res.status === 401) {
    const payload = await readPayload(res);
    if (shouldRedirectToLogin()) {
      window.location.href = '/login';
    }
    throw new ApiError(payload?.message ?? 'Tu sesión expiró.', 401, payload?.fieldErrors ?? null);
  }

  if (!res.ok) {
    const payload = await readPayload(res);
    throw new ApiError(
      payload?.message ?? 'Ocurrió un error inesperado.',
      res.status,
      payload?.fieldErrors ?? null,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/** Legacy RequestInit-compatible wrapper — used by pages not yet migrated. */
export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase() as RequestOptions['method'];
  const headers: Record<string, string> = {};
  if (init?.body != null) {
    headers['Content-Type'] = 'application/json';
  }
  return apiFetch<T>(url, {
    method,
    body: init?.body ?? undefined,
    signal: init?.signal ?? undefined,
    headers,
  });
}

interface XhrUploadOptions extends Omit<RequestOptions, 'body'> {
  body: FormData;
  onProgress?: (percent: number) => void;
}

/** Progress-tracked multipart upload used by the creative upload flow. */
export function uploadWithProgress<T>(path: string, options: XhrUploadOptions): Promise<T> {
  const { body, onProgress, headers = {} } = options;
  const requestHeaders: Record<string, string> = { ...headers };
  const token = csrfToken();
  if (token != null) {
    requestHeaders['X-CSRF-Token'] = token;
  }

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);

    Object.entries(requestHeaders).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
    }

    xhr.onerror = () => reject(new ApiError('No pudimos conectarnos con el servidor.', 0));
    xhr.ontimeout = () => reject(new ApiError('La subida tardó demasiado.', 0));

    xhr.onload = () => {
      let payload: ApiErrorPayload | null = null;
      try {
        payload = JSON.parse(xhr.responseText) as ApiErrorPayload;
      } catch {
        payload = null;
      }
      if (xhr.status >= 400) {
        reject(
          new ApiError(
            payload?.message ?? 'Ocurrió un error inesperado.',
            xhr.status,
            payload?.fieldErrors ?? null,
          ),
        );
        return;
      }
      if (xhr.status === 204) {
        resolve(undefined as T);
        return;
      }
      resolve(JSON.parse(xhr.responseText) as T);
    };

    xhr.send(body);
  });
}