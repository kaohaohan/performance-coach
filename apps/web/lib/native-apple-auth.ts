// Native (Capacitor/iOS) half of Sign in with Apple.
//
// Why this exists: Capacitor's WKWebView cannot run Firebase's web OAuth
// flows (its WKUIDelegate returns nil from createWebViewWith and hands the
// URL to the system browser — the same wall documented in
// lib/native-google-auth.ts). Apple's own ASAuthorizationController sheet
// does the authentication natively, and the identity token it returns is
// converted into a Firebase credential. Firebase stays a pure JS-SDK
// dependency: no native Firebase plugin is added.
//
// iOS only by design: Guideline 4.8 requires Sign in with Apple on the App
// Store build, the button is not rendered on web, and no web Apple path is
// implemented here.
import { OAuthProvider, type AuthCredential } from "firebase/auth";

// The plugin is imported dynamically, never at module scope — the web
// bundle and the Next.js server render must not pull native plugin code
// they can never use.
type SocialLoginModule = typeof import("@capgo/capacitor-social-login");

let initialized = false;

// nativeAppleCancelled marks the "person dismissed the Apple sheet" case so
// the UI can stay silent about it. A thrown sentinel (rather than a null
// return) keeps the happy path's type honest: the caller either gets a
// credential or an error, never a credential-shaped nothing.
export class NativeAppleCancelledError extends Error {
  constructor() {
    super("Sign in with Apple was cancelled");
    this.name = "NativeAppleCancelledError";
  }
}

// The plugin's native layer maps ASAuthorizationError.canceled to a stable
// rejection with code "USER_CANCELLED" (verified in the installed 8.4.5
// source, SocialLoginPlugin.swift). The substring fallback covers drift in
// that mapping across plugin versions.
export function isAppleCancellation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "USER_CANCELLED") {
    return true;
  }
  return (e?.message?.toLowerCase() ?? "").includes("cancel");
}

async function ensureInitialized(mod: SocialLoginModule): Promise<void> {
  if (initialized) {
    return;
  }

  // Native iOS needs no clientId/redirectUrl — those configure the web and
  // Android flows only. The empty block must still be passed: the native
  // plugin rejects Apple initialize/login when no apple settings object was
  // ever provided (and when capacitor.config.ts lacks apple: true).
  // Initialize is per-provider in the native implementation, so this cannot
  // clobber the Google settings initialized by native-google-auth.ts.
  await mod.SocialLogin.initialize({ apple: {} });
  initialized = true;
}

// rawNonce/hashedNonce implement Firebase's recommended replay protection
// for Apple: Apple receives SHA-256(rawNonce) and Firebase receives the raw
// value, so an intercepted identity token cannot be replayed. Both
// crypto.getRandomValues and crypto.subtle are available in the Capacitor
// secure context.
function rawNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// nativeAppleCredential runs Apple's native sign-in sheet and returns a
// Firebase credential for the identity chosen. Throws
// NativeAppleCancelledError if the person dismissed the sheet.
//
// Note: Apple only includes the person's name (and grants email) on the
// first-ever authorization of this app. Callers that pre-fill a name from
// user.displayName must already tolerate null — the existing signup/join
// forms do.
export async function nativeAppleCredential(): Promise<AuthCredential> {
  const mod = await import("@capgo/capacitor-social-login");
  await ensureInitialized(mod);

  const nonce = rawNonce();
  let result;
  try {
    result = await mod.SocialLogin.login({
      provider: "apple",
      options: {
        scopes: ["name", "email"],
        nonce: await sha256Hex(nonce),
      },
    });
  } catch (err) {
    if (isAppleCancellation(err)) {
      throw new NativeAppleCancelledError();
    }
    throw err;
  }

  const payload = result.result;
  if (!payload.idToken) {
    throw new Error("native apple sign-in: Apple returned no identity token");
  }

  return new OAuthProvider("apple.com").credential({
    idToken: payload.idToken,
    rawNonce: nonce,
  });
}
