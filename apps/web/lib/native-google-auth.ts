// Native (Capacitor/iOS) half of Google sign-in.
//
// Why this exists at all: Capacitor's WKWebView cannot run
// signInWithPopup. Its WKUIDelegate implements createWebViewWith by
// always returning nil and passing the URL to the system browser
// (@capacitor/ios Capacitor/WebViewDelegationHandler.swift), so the
// window.open() that Firebase's popup resolver depends on returns null and
// the SDK reports auth/popup-blocked. See
// docs/tasks/2026-08-23-ios-google-signin-webview.md.
//
// The fix is to let Google's own native sheet do the OAuth, then convert
// the ID token it returns into a Firebase credential. Firebase stays a
// pure JS-SDK dependency: no native Firebase plugin is added, and the web
// sign-in path is untouched.
import { GoogleAuthProvider, type AuthCredential } from "firebase/auth";

// The plugin is imported dynamically, never at module scope. Two reasons:
// the web bundle and the Next.js server render must not pull native plugin
// code they can never use, and the import cost is only paid by someone who
// actually taps the button inside the app.
type SocialLoginModule = typeof import("@capgo/capacitor-social-login");

let initialized = false;

// nativeGoogleCancelled marks the "person backed out of the Google sheet"
// case so the UI can stay silent about it, mirroring how the web flow
// treats auth/popup-closed-by-user. A thrown sentinel (rather than a null
// return) keeps the happy path's type honest: the caller either gets a
// credential or an error, never a credential-shaped nothing.
export class NativeGoogleCancelledError extends Error {
  constructor() {
    super("Google sign-in was cancelled");
    this.name = "NativeGoogleCancelledError";
  }
}

// The plugin surfaces user-cancellation as a message rather than a stable
// code, and the wording differs across the iOS/Android SDKs underneath, so
// match on the substrings all of them share.
function isCancellation(err: unknown): boolean {
  const message = (err as { message?: string })?.message?.toLowerCase() ?? "";
  return (
    message.includes("cancel") ||
    message.includes("canceled") ||
    message.includes("cancelled") ||
    message.includes("user closed")
  );
}

async function ensureInitialized(mod: SocialLoginModule): Promise<void> {
  if (initialized) {
    return;
  }

  // Public client configuration, not a secret: an OAuth client ID for an
  // installed app is published inside the app binary by design, which is
  // why it sits alongside the other NEXT_PUBLIC_* Firebase values. No
  // client secret is involved and none may be added here.
  const iOSClientId = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iOSClientId) {
    throw new Error(
      "native google sign-in: missing NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID",
    );
  }

  await mod.SocialLogin.initialize({ google: { iOSClientId } });
  initialized = true;
}

// nativeGoogleCredential runs Google's native sign-in sheet and returns a
// Firebase credential for the account chosen. Throws
// NativeGoogleCancelledError if the person dismissed the sheet.
export async function nativeGoogleCredential(): Promise<AuthCredential> {
  const mod = await import("@capgo/capacitor-social-login");
  await ensureInitialized(mod);

  let result;
  try {
    result = await mod.SocialLogin.login({
      provider: "google",
      options: {
        scopes: ["profile", "email"],
        // Carries over the web flow's prompt: "select_account". Without it
        // Google silently reuses whichever account the device is already
        // signed into — the shared-phone case that would attach an invite
        // to the wrong Firebase identity.
        forcePrompt: true,
      },
    });
  } catch (err) {
    if (isCancellation(err)) {
      throw new NativeGoogleCancelledError();
    }
    throw err;
  }

  const payload = result.result;
  // Offline mode returns an auth code for a backend to exchange instead of
  // an ID token. We never request it, so treat it as a configuration bug
  // rather than silently failing later inside Firebase.
  if (payload.responseType !== "online") {
    throw new Error(
      "native google sign-in: expected an online response with an ID token",
    );
  }
  if (!payload.idToken) {
    throw new Error("native google sign-in: Google returned no ID token");
  }

  return GoogleAuthProvider.credential(payload.idToken);
}
