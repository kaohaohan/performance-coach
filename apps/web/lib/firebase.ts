// Firebase client SDK initialization.
//
// Local development points at the Firebase Auth Emulator (see repo-root
// README.md "Local Backend Startup" / .env.example) — the same emulator the
// Go API's Admin SDK verifies tokens against via FIREBASE_AUTH_EMULATOR_HOST.
// NEXT_PUBLIC_FIREBASE_PROJECT_ID is not a real Firebase project; the API
// key is a placeholder the emulator does not validate.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`firebase: missing required env var ${name}`);
  }
  return value;
}

function createApp(): FirebaseApp {
  // authDomain is the domain signInWithPopup opens to run the OAuth
  // handshake (https://<authDomain>/__/auth/handler), so Google sign-in
  // needs it. It stays optional rather than required: local development
  // runs against the Auth Emulator, which serves its own sign-in handler
  // and ignores authDomain entirely, and every other route in the app
  // works without it. Omitting it in a deployed environment surfaces as
  // auth/auth-domain-config-required on the first Google click, which
  // components/google-sign-in-button.tsx maps to actionable copy.
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;

  const config = {
    apiKey: requireEnv(
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      "NEXT_PUBLIC_FIREBASE_API_KEY",
    ),
    projectId: requireEnv(
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    ),
    ...(authDomain ? { authDomain } : {}),
  };

  const existing = getApps();
  return existing.length > 0 ? existing[0] : initializeApp(config);
}

let cachedAuth: Auth | null = null;

// getFirebaseAuth returns a singleton Auth instance, wired to the local
// emulator when NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST is set. Emulator
// connection must only happen once per Auth instance, hence the module-level
// cache.
export function getFirebaseAuth(): Auth {
  if (cachedAuth) {
    return cachedAuth;
  }

  const auth = getAuth(createApp());

  const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  if (emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}`, {
      disableWarnings: true,
    });
  }

  cachedAuth = auth;
  return auth;
}
