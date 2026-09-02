// One shared way to turn a thrown value into something a person can read.
//
// Replaces the fourteen per-page errorMessage() / *AuthErrorMessage() helpers
// (decision D2 in docs/tasks/2026-08-27-i18n-zh-tw.md). Those helpers are the
// reason the same failure already reads differently on different screens;
// translating them in place would have produced fourteen drifting copies in
// two languages instead of one.
//
// React-free on purpose, like locale.ts and for the same reason: `node --test`
// strips TypeScript types but cannot parse JSX, so anything that lives in a
// .tsx file is untestable in this repo. Every decision this module makes —
// precedence, silencing, server-message passthrough, fallback — is therefore
// here, and errors.test.ts covers it. The two sign-in buttons keep only a
// one-line call.
//
// Resolution never produces an English literal: a call site gets back either a
// message-catalog key (which the caller translates through useT()) or text the
// server itself wrote. That distinction is the whole point of the union below.
import { ApiError } from "../api.ts";
import type { MessageVars } from "./locale.ts";
import { en, type MessageKey } from "./messages/en/index.ts";

// SILENT marks a code that must produce no message at all. Dismissing the
// Google account chooser or the Apple sheet is a decision, not a failure, and
// a red alert for it just makes the app look broken.
export const SILENT = "silent" as const;

export type ErrorResolution =
  // Translate this key. The only outcome that changes with the locale.
  | { readonly kind: "key"; readonly key: MessageKey }
  // Show this verbatim: the Go API is the authority on why it rejected a
  // request, and its `{ error: { message } }` copy has no key space here.
  // (Those strings are still English — localizing them is a backend change
  // and is out of scope for this task, which is frontend-only.)
  | { readonly kind: "text"; readonly text: string }
  // Show nothing.
  | { readonly kind: "silent" };

// ErrorPolicy is what a call site contributes: the codes only it can see, and
// what "anything else" should say. Everything shared lives in this file.
export type ErrorPolicy = {
  // Error *names* (not codes) that mean "the person backed out". The native
  // sign-in wrappers throw sentinels rather than Firebase codes — see
  // lib/native-google-auth.ts and lib/native-apple-auth.ts.
  readonly silentNames?: readonly string[];
  // Code → key for this surface. Checked before COMMON_AUTH_CODES, so a
  // policy can give a shared code its own meaning (Apple does this with
  // auth/invalid-credential).
  readonly codes?: Readonly<Partial<Record<string, MessageKey | typeof SILENT>>>;
  // HTTP status → key, for the ApiError statuses a screen explains itself
  // (e.g. /coach-signup's 409). Checked before serverMessage so the specific
  // explanation wins over the generic one.
  readonly statuses?: Readonly<Partial<Record<number, MessageKey>>>;
  // Pass an ApiError's own message through instead of falling back. This is
  // what the eight plain `err instanceof ApiError ? err.message : …` helpers
  // across the app were doing.
  readonly serverMessage?: boolean;
  // Used when nothing else matched. Defaults to "errors.unexpected".
  readonly fallback?: MessageKey;
};

// COMMON_AUTH_CODES is applied to every policy. It holds only the Firebase
// codes whose copy is correct on any sign-in surface — a blocked network or a
// disabled account reads the same whether the person used a password, Google
// or Apple.
//
// Codes whose copy is only right on *some* surfaces are deliberately not here.
// "auth/invalid-credential" is the example that forced the split: on a
// password form it means "Incorrect email or password", but on the Google
// popup that sentence is nonsense and on Apple it means the provider is
// misconfigured. Those live in PASSWORD_AUTH_CODES and in the per-provider
// policies instead, so consolidation cannot quietly put the wrong sentence on
// a screen.
export const COMMON_AUTH_CODES: Readonly<Partial<Record<string, MessageKey | typeof SILENT>>> = {
  "auth/network-request-failed": "errors.network",
  "auth/too-many-requests": "errors.auth.tooManyRequests",
  "auth/user-disabled": "errors.auth.userDisabled",
};

// PASSWORD_AUTH_CODES is opt-in: spread it into a policy's `codes` on the
// email/password forms (/login, /coach/signup, /join/[code]). Sign-up forms
// use all of it; a sign-in-only form simply never sees the sign-up codes.
export const PASSWORD_AUTH_CODES: Readonly<Partial<Record<string, MessageKey | typeof SILENT>>> = {
  "auth/invalid-email": "errors.auth.invalidEmail",
  "auth/invalid-credential": "errors.auth.invalidCredentials",
  "auth/user-not-found": "errors.auth.invalidCredentials",
  "auth/wrong-password": "errors.auth.invalidCredentials",
  "auth/email-already-in-use": "errors.auth.emailInUse",
  "auth/weak-password": "errors.auth.weakPassword",
};

// The two social-provider policies live here rather than beside their buttons
// so they are covered by node --test: components/*.tsx cannot be loaded by it.
export const GOOGLE_AUTH_POLICY: ErrorPolicy = {
  // The iOS shell signs in through Google's native sheet rather than a popup
  // (lib/native-google-auth.ts), so dismissing it arrives as this sentinel
  // instead of auth/popup-closed-by-user. Same meaning, same silence.
  silentNames: ["NativeGoogleCancelledError"],
  codes: {
    "auth/popup-closed-by-user": SILENT,
    "auth/user-cancelled": SILENT,
    // Fires when a second popup supersedes the first (double tap). The
    // surviving popup is still running, so this is noise, not an error.
    "auth/cancelled-popup-request": SILENT,
    "auth/popup-blocked": "errors.google.popupBlocked",
    // Safari in Lockdown/Private modes can refuse the storage the popup
    // handshake needs.
    "auth/web-storage-unsupported": "errors.google.webStorageUnsupported",
    // Google is authoritative for addresses it hosts, so this is reachable
    // only for a non-Google-hosted address already registered under another
    // provider. Direct the person to the method they already have —
    // identities are never merged automatically.
    "auth/account-exists-with-different-credential": "errors.google.accountExists",
    // Configuration faults, not user faults: the Google provider is not
    // enabled, or this hostname is not an authorized domain / no authDomain
    // is configured. Generic copy for the user; the real cause is in the
    // console for whoever is testing.
    "auth/operation-not-allowed": "errors.google.unavailable",
    "auth/unauthorized-domain": "errors.google.unavailable",
    "auth/auth-domain-config-required": "errors.google.unavailable",
  },
  fallback: "errors.google.failed",
};

export const APPLE_AUTH_POLICY: ErrorPolicy = {
  // USER_CANCELLED from the Apple sheet, surfaced as a sentinel by
  // lib/native-apple-auth.ts.
  silentNames: ["NativeAppleCancelledError"],
  codes: {
    // The one collision this app must never resolve silently: the email on
    // the Apple credential belongs to an account created with another method.
    // Identities are never linked or merged automatically
    // (docs/tasks/2026-08-25-ios-apple-signin.md, founder correction #2) —
    // direct the person to the method that owns their existing account and
    // data.
    "auth/account-exists-with-different-credential": "errors.apple.accountExists",
    // Configuration faults, not user faults: the Apple provider is not
    // enabled in Firebase, or the Sign in with Apple capability is missing
    // from the build.
    "auth/operation-not-allowed": "errors.apple.unavailable",
    "auth/configuration-not-found": "errors.apple.unavailable",
    "auth/invalid-credential": "errors.apple.unavailable",
  },
  fallback: "errors.apple.failed",
};

// resolveError is the single decision point. Order matters and is fixed:
//
//   1. a sentinel name the policy calls silent — checked first, because a
//      cancelled sign-in must never be reported however it is dressed up;
//   2. the policy's own code table, then COMMON_AUTH_CODES;
//   3. an ApiError status the policy explains itself;
//   4. the ApiError's own message, when the policy asked for it;
//   5. the policy's fallback, else "errors.unexpected".
//
// Takes `unknown` rather than Error because that is what a catch block hands
// over: a thrown string, null, or a rejected non-Error all have to land on the
// fallback rather than throw a second time inside the error handler.
export function resolveError(err: unknown, policy: ErrorPolicy = {}): ErrorResolution {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  if (typeof name === "string" && policy.silentNames?.includes(name)) {
    return { kind: "silent" };
  }

  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string") {
    const mapped = policy.codes?.[code] ?? COMMON_AUTH_CODES[code];
    if (mapped === SILENT) return { kind: "silent" };
    if (mapped !== undefined) return { kind: "key", key: mapped };
  }

  if (err instanceof ApiError) {
    const byStatus = policy.statuses?.[err.status];
    if (byStatus !== undefined) return { kind: "key", key: byStatus };
    // An ApiError with an empty message falls through to the fallback: a
    // blank alert box is worse than a generic sentence.
    if (policy.serverMessage === true && err.message.trim() !== "") {
      return { kind: "text", text: err.message };
    }
  }

  return { kind: "key", key: policy.fallback ?? "errors.unexpected" };
}

// Structurally identical to the Translate type exported by ./index.tsx.
// Restated here because importing it would pull JSX into this file and make
// it unloadable under `node --test` — the one thing this module exists to
// avoid.
export type TranslateFn = (key: MessageKey, vars?: MessageVars) => string;

// errorMessage is what a component calls: pass useT()'s `t`, the caught value
// and the policy for this surface. null means "show nothing" — assign it
// straight into a `string | null` error state.
export function errorMessage(t: TranslateFn, err: unknown, policy?: ErrorPolicy): string | null {
  const resolved = resolveError(err, policy);
  switch (resolved.kind) {
    case "silent":
      return null;
    case "text":
      return resolved.text;
    case "key":
      return t(resolved.key);
  }
}

// untranslatedErrorMessage is a migration bridge, not an API: it resolves
// against the English catalog directly, for call sites that have not been
// converted to useT() yet. Sub-tasks 2c–5 delete their uses as they convert
// each page. Do not add a new caller — a component that can read `t` should.
export function untranslatedErrorMessage(err: unknown, policy?: ErrorPolicy): string | null {
  return errorMessage((key) => en[key], err, policy);
}
