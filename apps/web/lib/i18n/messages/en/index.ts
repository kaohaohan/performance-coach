// English message catalog — the key space for the whole app.
//
// One file per area, merged here. The split is not cosmetic: sub-tasks 2–6
// of docs/tasks/2026-08-27-i18n-zh-tw.md run as separate sessions on
// separate branches, and a single catalog file would put every one of them
// in conflict at the same closing brace. Adding an area now means one new
// file per locale plus one line in each index — the only shared line.
//
// `en` is both the source language and the fallback, so this file defines
// which keys exist: MessageKey is derived from it, and each zh-TW area file
// is typed against its English counterpart, which makes an untranslated key
// a compile error rather than a string that silently shows up in English on
// a Chinese screen.
//
// Keys are dotted and area-first, matching the file tree so a string's home
// is obvious: login.*, coachSignup.*, calendar.*, today.*, session.*,
// settings.*, clients.*, workouts.*, exercises.*, join.*, errors.* (shared),
// common.* (Save/Cancel/Delete/Back…).
import { auth } from "./auth.ts";
import { common } from "./common.ts";
import { errors } from "./errors.ts";
import { settings } from "./settings.ts";

export const en = {
  ...auth,
  ...common,
  ...errors,
  ...settings,
} as const;

// MessageKey is every key the app may ask for; Catalog is a complete
// translation of them. Both are derived from `en` on purpose — adding a key
// there is what makes it available (and required) everywhere else.
export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
