// Minimal API client for the Go API, reached same-origin via the /backend
// rewrite (see next.config.ts). This module has no React/context
// dependency so it can be called from anywhere (login flow, page effects).
export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ApiFetchOptions = {
  method?: string;
  body?: unknown;
};

async function request<T>(
  path: string,
  headers: Record<string, string>,
  options?: ApiFetchOptions,
): Promise<T> {
  const hasBody = options?.body !== undefined;

  const res = await fetch(`/backend${path}`, {
    method: options?.method ?? (hasBody ? "POST" : "GET"),
    headers: {
      ...headers,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let code: string | undefined;
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error?.message) {
        message = data.error.message;
      }
      if (data?.error?.code) {
        code = data.error.code;
      }
    } catch {
      // Response body wasn't valid JSON (or empty) — keep the generic message.
    }
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// apiFetch calls `/backend${path}` with a Bearer token, JSON-encoding the
// body (if present) and JSON-decoding the response. On a non-2xx response it
// tries to decode the API's `{ error: { code, message } }` envelope and
// throws ApiError; falls back to a generic message if the body doesn't match.
export async function apiFetch<T>(
  idToken: string,
  path: string,
  options?: ApiFetchOptions,
): Promise<T> {
  return request<T>(path, { Authorization: `Bearer ${idToken}` }, options);
}

// publicApiFetch is apiFetch without a Bearer token, for the one route that
// is reachable by a fully anonymous caller: GET /invite-codes/{code}/preview
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.2). Shares ApiError and
// the same envelope parsing as apiFetch — callers should not need to know
// which of the two they're using beyond "am I authenticated yet."
export async function publicApiFetch<T>(
  path: string,
  options?: ApiFetchOptions,
): Promise<T> {
  return request<T>(path, {}, options);
}
