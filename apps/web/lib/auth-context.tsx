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
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { getFirebaseAuth } from "./firebase";
import { nativeAppleCredential } from "./native-apple-auth";
import { nativeGoogleCredential } from "./native-google-auth";
import { setAuthTokenProvider } from "./api";

// SocialSignInResult carries both halves a caller needs after a social
// sign-in: the fresh ID token to authenticate the very next API call, and
// the Firebase user itself — coach signup reads displayName off it to
// pre-fill the Coach's name.
export type SocialSignInResult = {
  idToken: string;
  user: User;
};
export type GoogleSignInResult = SocialSignInResult;

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
  // signInWithGoogle authenticates against the Google provider and, like
  // signIn/signUp, hands back a token taken straight from the credential.
  //
  // It provisions nothing by itself. Firebase alone decides which Firebase
  // user this Google identity resolves to — including linking it to an
  // existing password account for the same address under the project's
  // "One account per email address" setting, which is what lets a pilot
  // user who registered with Gmail + password keep their UID (and so their
  // users.firebase_uid, relationships and history) after switching to
  // Google. This app never resolves identity by email and never merges
  // application users; see docs/tasks/2026-08-20-google-signin-account-continuity.md.
  signInWithGoogle: () => Promise<GoogleSignInResult>;
  // signInWithApple is iOS-only (Guideline 4.8 — see
  // docs/tasks/2026-08-25-ios-apple-signin.md). It provisions nothing by
  // itself and never links or merges accounts: identity is firebase_uid,
  // and if Firebase rejects the credential with
  // auth/account-exists-with-different-credential the error propagates
  // untouched so the UI can direct the person back to their existing
  // sign-in method — preserving their existing backend account and data.
  // Automatic provider linking is a separate future feature, not 1.0.
  signInWithApple: () => Promise<SocialSignInResult>;
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

  // signInWithPopup, not signInWithRedirect: the redirect flow finishes by
  // reading storage owned by the authDomain sign-in helper, which is
  // cross-origin to our Vercel host and blocked by Safari 16.1+, Firefox
  // 109+ and Chrome M115+. Firebase's redirect best-practices guidance
  // names switching to popup as the fix for apps not served from Firebase
  // Hosting. Popup also keeps the athlete invite flow a single
  // uninterrupted client state machine, so /join/<code> cannot be lost
  // across a navigation. Callers must invoke this only from an explicit
  // user gesture — browsers block popups opened any other way.
  //
  // ...except inside the iOS Capacitor shell, where popup cannot work at
  // all: Capacitor's WKUIDelegate implements createWebViewWith by always
  // returning nil and handing the URL to the system browser instead
  // (@capacitor/ios WebViewDelegationHandler.swift), so window.open()
  // resolves to null and Firebase throws auth/popup-blocked. Google's
  // chooser does appear — in Safari, detached from the JS context that
  // already failed. The native branch below therefore runs Google's own
  // sign-in sheet and exchanges the resulting ID token for a Firebase
  // credential; both branches converge on the same GoogleSignInResult, so
  // /login, /join/[code] and /coach/signup need no platform awareness.
  async function signInWithGoogle(): Promise<GoogleSignInResult> {
    const auth = getFirebaseAuth();

    if (Capacitor.isNativePlatform()) {
      const credential = await nativeGoogleCredential();
      const result = await signInWithCredential(auth, credential);
      return { idToken: await result.user.getIdToken(), user: result.user };
    }

    const provider = new GoogleAuthProvider();
    // Always show the account chooser. Left to itself Google reuses the one
    // session already in the browser, which is how someone on a shared
    // phone signs in as the wrong person — and on the invite flow that
    // would attach the invite to the wrong Firebase identity.
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await signInWithPopup(auth, provider);
    // Same reasoning as signIn/signUp: return the token directly rather
    // than racing the onIdTokenChanged update above.
    return { idToken: await credential.user.getIdToken(), user: credential.user };
  }

  // signInWithApple mirrors signInWithGoogle's native branch. There is no
  // web branch: the Apple button is only rendered inside the iOS shell
  // (Guideline 4.8 requires it as an equivalent option there), so calling
  // this off-platform is a programmer error, not a user-facing state.
  async function signInWithApple(): Promise<SocialSignInResult> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error(
        "auth-context: Sign in with Apple is only available in the iOS app",
      );
    }
    const auth = getFirebaseAuth();
    const credential = await nativeAppleCredential();
    const result = await signInWithCredential(auth, credential);
    // Same reasoning as signIn/signInWithGoogle: return the token directly
    // rather than racing the onIdTokenChanged update above.
    return { idToken: await result.user.getIdToken(), user: result.user };
  }

  async function signOut() {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, idToken, getIdToken, loading, signIn, signUp, signInWithGoogle, signInWithApple, signOut }}>
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
