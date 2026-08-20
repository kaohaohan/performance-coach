"use client";

// The single Google entry point shared by /login, /join/[code] and
// /coach/signup. One component so the three journeys cannot drift apart in
// wording, size or error handling — the button itself is identical
// everywhere; only the caller's onClick differs in which endpoint it then
// calls with the fresh token.

// googleAuthErrorMessage maps Firebase Auth error codes to copy, following
// the same pattern as loginErrorMessage / firebaseAuthErrorMessage on the
// password forms. Raw Firebase error strings are never shown.
//
// Returns null for the codes that mean "the person deliberately backed
// out" — dismissing the account chooser is not a failure, and showing a red
// alert for it just makes the app look broken.
export function googleAuthErrorMessage(err: unknown): string | null {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/user-cancelled":
    // Fires when a second popup supersedes the first (double tap). The
    // surviving popup is still running, so this is noise, not an error.
    case "auth/cancelled-popup-request":
      return null;
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.";
    // Safari in Lockdown/Private modes can refuse the storage the popup
    // handshake needs.
    case "auth/web-storage-unsupported":
      return "Your browser is blocking the storage Google sign-in needs. Try again in a normal (non-private) window, or use your email and password.";
    // Google is authoritative for addresses it hosts, so this is reachable
    // only for a non-Google-hosted address already registered under another
    // provider. Direct the person to the method they already have —
    // identities are never merged automatically.
    case "auth/account-exists-with-different-credential":
      return "That email is already registered with a different sign-in method. Sign in with your email and password instead.";
    // Configuration faults, not user faults: the Google provider is not
    // enabled, or this hostname is not an authorized domain / no authDomain
    // is configured. Generic copy for the user; the real cause is in the
    // console for whoever is testing.
    case "auth/operation-not-allowed":
    case "auth/unauthorized-domain":
    case "auth/auth-domain-config-required":
      return "Google sign-in isn't available yet. Please use your email and password, or contact your coach.";
    case "auth/network-request-failed":
      return "Network problem. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    default:
      return "Google sign-in failed. Please try again.";
  }
}

// GoogleMark is Google's four-colour "G", inlined so the button renders
// without a network round-trip and works offline in the PWA shell.
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-5 w-5 shrink-0">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

// GoogleSignInButton must only ever be rendered as an explicit tap target:
// signInWithPopup opened outside a user gesture is blocked by every modern
// browser.
export function GoogleSignInButton({
  onClick,
  pending,
  disabled,
  label = "Continue with Google",
}: {
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-5 text-base font-bold text-slate-800 shadow-sm transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-slate-400"
    >
      {pending ? null : <GoogleMark />}
      {pending ? "Opening Google…" : label}
    </button>
  );
}

// AuthDivider is the "or" rule separating the Google button from the
// email/password form. Decorative only — aria-hidden so it is not announced
// between the two real controls.
export function AuthDivider() {
  return (
    <div aria-hidden="true" className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">or</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}
