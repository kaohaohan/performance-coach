"use client";

// Client-side auth state: wraps Firebase Auth's user/session and exposes the
// current ID token for calling the Go API. No server session/cookie exists
// yet — the ID token lives in memory only (re-fetched on Firebase's own
// token refresh), per this phase's scope (login flow only).
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

// GoogleSignInResult carries both halves a caller needs after a Google
// sign-in: the fresh ID token to authenticate the very next API call, and
// the Firebase user itself — coach signup reads displayName off it to
// pre-fill the Coach's name.
export type GoogleSignInResult = {
  idToken: string;
  user: User;
};

type AuthContextValue = {
  user: User | null;
  idToken: string | null;
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
  async function signInWithGoogle(): Promise<GoogleSignInResult> {
    const auth = getFirebaseAuth();
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

  async function signOut() {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, idToken, loading, signIn, signUp, signInWithGoogle, signOut }}>
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
