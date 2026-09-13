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
  // After a sensitive re-auth (account deletion), mint a token with a
  // refreshed auth_time instead of the SDK's possibly-cached ID token.
  freshToken?: boolean;
};

// A Firebase ID token expires one hour after it is minted. Callers hold the
// token as a React state string (useAuth().idToken), captured whenever
// onIdTokenChanged last fired — which on a phone means "whenever the tab was
// last awake." A screen lock mid-workout suspends the SDK's proactive
// refresh timer, so the captured string can be minutes-to-hours stale by the
// time the athlete taps Log Set, and the API rejects it with 401
// UNAUTHENTICATED ("missing or invalid authentication").
//
// The fix is to mint the token at request time rather than trust a captured
// one: getIdToken() returns the cached token while it is still valid and
// silently exchanges the refresh token when it is not. AuthProvider registers
// that call here once (setAuthTokenProvider), so every existing
// apiFetch(idToken, ...) call site gets fresh-token behaviour without each
// page having to thread a token getter through its own state.
export type AuthTokenProvider = (forceRefresh?: boolean) => Promise<string>;

let authTokenProvider: AuthTokenProvider | null = null;

// setAuthTokenProvider is called by AuthProvider (lib/auth-context.tsx) on
// mount and unmount. Passing null restores the "use whatever token the caller
// passed" behaviour, which is also what happens before the provider mounts
// and in unit/SSR contexts where no Firebase Auth instance exists.
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

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

function authorized<T>(
  path: string,
  token: string,
  options?: ApiFetchOptions,
): Promise<T> {
  return request<T>(path, { Authorization: `Bearer ${token}` }, options);
}

// apiFetch calls `/backend${path}` with a Bearer token, JSON-encoding the
// body (if present) and JSON-decoding the response. On a non-2xx response it
// tries to decode the API's `{ error: { code, message } }` envelope and
// throws ApiError; falls back to a generic message if the body doesn't match.
//
// The token actually sent is the one minted by the registered
// AuthTokenProvider (see above), not necessarily `idToken` — the argument is
// the caller's possibly-stale snapshot and is used only as a fallback when no
// provider is registered or when minting fails (e.g. offline: sending the old
// token at least lets a still-valid one through). A 401 is retried exactly
// once with a force-refreshed token, since a 401 means the server rejected
// the request before doing any work, so replaying it cannot double-write.
export async function apiFetch<T>(
  idToken: string,
  path: string,
  options?: ApiFetchOptions,
): Promise<T> {
  const provider = authTokenProvider;
  if (provider === null) {
    return authorized<T>(path, idToken, options);
  }

  let token: string;
  try {
    token = await provider(options?.freshToken === true);
  } catch {
    token = idToken;
  }

  try {
    return await authorized<T>(path, token, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }

    let refreshed: string;
    try {
      refreshed = await provider(true);
    } catch {
      throw expiredSignIn(error);
    }
    if (refreshed === token) {
      throw expiredSignIn(error);
    }

    try {
      return await authorized<T>(path, refreshed, options);
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) {
        throw expiredSignIn(retryError);
      }
      throw retryError;
    }
  }
}

// expiredSignIn rewrites a 401 that survived a forced token refresh. The API's
// own wording ("missing or invalid authentication") describes the request, not
// what the person holding the phone should do about it; by this point the only
// remaining causes are a revoked/expired refresh token or a Firebase account
// with no matching internal user, and both are resolved by signing in again.
// The code is preserved so callers can still branch on UNAUTHENTICATED.
function expiredSignIn(error: ApiError): ApiError {
  return new ApiError(
    error.status,
    "Your sign-in has expired or is no longer valid. Please sign in again.",
    error.code,
  );
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
