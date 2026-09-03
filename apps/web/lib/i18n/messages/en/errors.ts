// Shared error copy. The 14 per-page errorMessage() / *AuthErrorMessage()
// helpers consolidate onto these keys (decision D2 in the task doc), through
// lib/i18n/errors.ts.
//
// Scope of this file: error copy that is *cross-cutting* — the same sentence
// belongs on more than one screen, or it describes an auth/transport failure
// rather than one page's workflow. Error copy that only one page can ever
// show (a coach-signup provisioning conflict) belongs in that page's area
// file, not here. Keeping the line there is what stops errors.ts growing back
// into the fourteen-way duplication it replaced.
//
// errors.deletion.* is the one block that looks like page copy and is not:
// the sentences are thrown by lib/account-deletion.ts, a React-free module
// that cannot import a locale context and must not depend on the one page
// that happens to render it today. Its keys therefore live with the other
// shared error copy rather than in settings.*.
export const errors = {
  "errors.network": "Couldn't reach the server. Check your connection and try again.",
  "errors.unexpected": "Something went wrong. Please try again.",

  // Firebase Auth, provider-agnostic. Reached from every sign-in surface.
  "errors.auth.signInFailed": "Sign in failed. Please try again.",
  "errors.auth.invalidEmail": "Enter a valid email address.",
  "errors.auth.invalidCredentials": "Incorrect email or password.",
  "errors.auth.emailInUse": "An account with that email already exists. Try signing in instead.",
  "errors.auth.weakPassword": "Password must be at least 8 characters.",
  "errors.auth.tooManyRequests": "Too many attempts. Try again later.",
  "errors.auth.userDisabled": "This account has been disabled.",

  // Google sign-in. Provider-specific because the remedies are: pop-ups,
  // browser storage, and "use the method that already owns your account".
  "errors.google.popupBlocked":
    "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.",
  "errors.google.webStorageUnsupported":
    "Your browser is blocking the storage Google sign-in needs. Try again in a normal (non-private) window, or use your email and password.",
  "errors.google.accountExists":
    "That email is already registered with a different sign-in method. Sign in with your email and password instead.",
  "errors.google.unavailable":
    "Google sign-in isn't available yet. Please use your email and password, or contact your coach.",
  "errors.google.failed": "Google sign-in failed. Please try again.",

  // Sign in with Apple. accountExists is deliberately worded differently from
  // the Google one and must stay that way: identities are never linked or
  // merged automatically (docs/tasks/2026-08-25-ios-apple-signin.md, founder
  // correction #2), and on iOS the "method you originally used" is not
  // necessarily email and password.
  "errors.apple.accountExists":
    "An account with this email already exists using a different sign-in method. Sign in with the method you originally used.",
  "errors.apple.unavailable":
    "Sign in with Apple isn't available yet. Please use another sign-in method, or contact your coach.",
  "errors.apple.failed": "Sign in with Apple failed. Please try again.",

  // Account deletion (Guideline 5.1.1(v)). Thrown by lib/account-deletion.ts
  // as AccountDeletionError.messageKey and translated at the /settings call
  // site. This wording is constrained copy, not free product copy — see
  // docs/tasks/2026-08-26-account-deletion.md. Two rules hold in every
  // language: a failure must never read as if the account was deleted
  // anyway, and it must always say what the person can do next, because
  // deletion is the one flow Apple review re-walks.
  "errors.deletion.reauthFailed":
    "Couldn't confirm it's you. Sign in again and try deleting your account.",
  "errors.deletion.signedOut": "Please sign in again, then try deleting your account.",
  "errors.deletion.recentAuthRequired": "Please confirm it's you, then try again.",
  "errors.deletion.invalidRequest": "Couldn't confirm your sign-in. Try again.",
  // Reached only on the Apple path: the sheet came back without the
  // authorization code the backend needs to revoke the Apple token.
  "errors.deletion.appleCodeMissing": "Couldn't confirm your Apple sign-in. Try again.",
  // {app} is BRAND_NAME, passed in as a var rather than written into either
  // catalog: it is a product name, so it must read identically in both.
  "errors.deletion.appleRequiresIos":
    "To delete an account that uses Sign in with Apple, open the {app} iOS app and try again.",
  "errors.deletion.failed": "Couldn't delete your account. Check your connection and try again.",
} as const;

export type ErrorMessages = Record<keyof typeof errors, string>;
