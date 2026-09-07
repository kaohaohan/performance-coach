// /settings — the account screen both roles share, and the home of the
// language selector this whole task exists to ship.
//
// The account-deletion copy is not ordinary product copy. Its wording is
// what App Review reads against Guideline 5.1.1(v)
// (docs/tasks/2026-08-26-account-deletion.md): deletion removes the ability
// to sign in and erases personal identity, while training records the
// counterparty legitimately holds may remain in anonymised form. Both the
// section body and the confirmation body must keep saying exactly that — in
// both languages. Soften either half and the screen no longer describes what
// the backend actually does.
export const settings = {
  "settings.heading": "Account",
  "settings.subtitle": "Your PumpLoop account.",
  // Leading arrows are part of the label so the whole control is one string
  // a translator can reorder if they need to.
  "settings.backToToday": "← Today",
  "settings.backToCalendar": "← Coach Calendar",
  "settings.signedInAs": "Signed in as",
  "settings.roleCoach": "Coach",
  "settings.roleAthlete": "Client",

  "settings.language.heading": "Language",
  "settings.language.description": "Applies to this device only.",
  "settings.language.label": "Interface language",

  "settings.delete.heading": "Delete account",
  "settings.delete.description":
    "This permanently removes your ability to sign in. Your name and personal account details are removed. Training history your coach or athletes already share with you may remain in anonymized form.",
  "settings.delete.button": "Delete Account",
  "settings.delete.pending": "Deleting account…",
  "settings.delete.confirmTitle": "Delete your account?",
  "settings.delete.confirmBody":
    "You will no longer be able to sign in. Your personal account identity will be removed. Legitimate training records already shared with your coach or athletes may remain in anonymized form.",
  "settings.delete.passwordLabel": "Password",
  "settings.delete.passwordRequired": "Enter your password to delete your account.",
  "settings.delete.failed": "Couldn't delete your account. Check your connection and try again.",
} as const;

export type SettingsMessages = Record<keyof typeof settings, string>;
