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
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

type AuthContextValue = {
  user: User | null;
  idToken: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
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

  async function signIn(email: string, password: string) {
    const auth = getFirebaseAuth();
    await signInWithEmailAndPassword(auth, email, password);
    // onIdTokenChanged above updates user/idToken once Firebase resolves.
  }

  async function signOut() {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, idToken, loading, signIn, signOut }}>
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
