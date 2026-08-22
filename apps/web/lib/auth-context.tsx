"use client";

// Client-side auth state: wraps Firebase Auth's user/session and exposes the
// current ID token for calling the Go API. No server session/cookie exists
// yet — the ID token lives in memory only (re-fetched on Firebase's own
// token refresh), per this phase's scope (login flow only).
//
// The `idToken` string below is a snapshot from the last onIdTokenChanged
// callback and is safe for render gating ("is a token available yet"), but it
// must not be what an API call actually sends: an ID token expires an hour
// after it is minted, and a backgrounded tab (phone locked mid-workout) stops
// the SDK's refresh timer, leaving the snapshot stale. getIdToken() below
// mints on demand instead, and is registered with lib/api.ts so every
// apiFetch call uses it.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import { setAuthTokenProvider } from "./api";

type AuthContextValue = {
  user: User | null;
  // Snapshot of the current ID token for render gating only — see the module
  // comment above. To authenticate a request, use getIdToken().
  idToken: string | null;
  // Mints a valid ID token at call time: returns the cached one while it is
  // still valid, and silently exchanges the refresh token when it is not.
  // Rejects when nobody is signed in (or Firebase failed to initialize).
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  loading: boolean;
  // Returns a freshly-minted ID token directly from the sign-in credential,
  // rather than relying on the async onIdTokenChanged state update below —
  // callers that need a token immediately after signing in (e.g. login's
  // role lookup) would otherwise race that state update.
  signIn: (email: string, password: string) => Promise<string>;
  // signUp mirrors signIn but creates a new Firebase account
  // (createUserWithEmailAndPassword). Used only by the join flow
  // (docs/athlete-onboarding-invite-codes-v0.1.md §7.6) — it does not
  // create a PostgreSQL `users` row by itself; that happens on redeem.
  signUp: (email: string, password: string) => Promise<string>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // AuthProvider wraps the whole app (app/layout.tsx), including routes
    // that have nothing to do with login. A Firebase misconfiguration (e.g.
    // missing NEXT_PUBLIC_FIREBASE_* env vars) must not crash unrelated
    // pages with an uncaught error — fail closed to "signed out" instead,
    // and let signIn() below surface the real error where it's actionable.
    let auth;
    try {
      auth = getFirebaseAuth();
    } catch (err) {
      console.error("auth-context: Firebase did not initialize:", err);
      // Deferred (not called synchronously in the effect body) per
      // react-hooks/set-state-in-effect.
      Promise.resolve().then(() => setLoading(false));
      return;
    }

    const unsubscribe = onIdTokenChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setIdToken(nextUser ? await nextUser.getIdToken() : null);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // getIdToken is the single source of a *valid* token. currentUser is read
  // at call time rather than closed over, so the callback keeps a stable
  // identity across sign-ins and re-renders (safe to register once below and
  // to put in an effect's dependency list). getIdToken(false) returns the
  // SDK's cached token unless it is expired or within five minutes of
  // expiring, so this is not a network call per request.
  const getIdToken = useCallback(async (forceRefresh = false): Promise<string> => {
    const currentUser = getFirebaseAuth().currentUser;
    if (!currentUser) {
      throw new Error("auth-context: no signed-in user");
    }
    return currentUser.getIdToken(forceRefresh);
  }, []);

  useEffect(() => {
    // Hand the API client a way to mint a token per request, so pages can go
    // on passing their captured `idToken` to apiFetch without that snapshot
    // being what gets sent (lib/api.ts, setAuthTokenProvider). Cleared on
    // unmount so a torn-down provider cannot keep serving tokens.
    setAuthTokenProvider(getIdToken);
    return () => setAuthTokenProvider(null);
  }, [getIdToken]);

  async function signIn(email: string, password: string): Promise<string> {
    const auth = getFirebaseAuth();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    // onIdTokenChanged above still updates user/idToken (async) for the rest
    // of the app's ongoing state. Return the token directly here so the
    // caller doesn't have to race that update.
    return credential.user.getIdToken();
  }

  async function signUp(email: string, password: string): Promise<string> {
    const auth = getFirebaseAuth();
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    // Same reasoning as signIn: return the token directly rather than
    // racing the onIdTokenChanged update above.
    return credential.user.getIdToken();
  }

  async function signOut() {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, idToken, getIdToken, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
