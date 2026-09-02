// English message catalog — the key space for the whole app.
//
// `en` is both the source language and the fallback, so this file defines
// which keys exist: MessageKey below is derived from it, and zh-TW.ts is
// typed as a full Catalog, which makes an untranslated key a compile error
// rather than a string that silently shows up in English on a Chinese
// screen. See docs/tasks/2026-08-27-i18n-zh-tw.md.
//
// Keys are dotted and area-first, matching the file tree so a string's home
// is obvious: login.*, coachSignup.*, calendar.*, today.*, session.*,
// settings.*, clients.*, workouts.*, exercises.*, join.*, errors.* (shared),
// common.* (Save/Cancel/Delete/Back…).
//
// This file currently carries only the shared surface (common.*, settings
// language selector, shared errors.*). Per-page keys arrive with the
// sub-tasks that convert those pages — foundation first, no page changes.
export const en = {
  // common.* — strings that already repeat verbatim across pages today.
  "common.loading": "Loading…",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.done": "Done",
  "common.back": "Back",
  "common.edit": "Edit",
  "common.add": "Add",
  "common.remove": "Remove",
  "common.delete": "Delete",
  "common.retry": "Retry",

  // settings.* — only the language selector lands in this sub-task; the rest
  // of /settings is converted in sub-task 5.
  "settings.language.heading": "Language",
  "settings.language.description": "Applies to this device only.",
  "settings.language.label": "Interface language",

  // errors.* — the shared error copy the 14 per-page errorMessage() helpers
  // consolidate onto in sub-task 2 (decision D2).
  "errors.network": "Couldn't reach the server. Check your connection and try again.",
  "errors.unexpected": "Something went wrong. Please try again.",
} as const;

// MessageKey is every key the app may ask for; Catalog is a complete
// translation of them. Both are derived from `en` on purpose — adding a key
// here is what makes it available (and required) everywhere else.
export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
