// Locale resolution and message lookup — pure functions, no React and no
// browser globals at module scope, so this file is directly unit-testable
// under `node --test` (see i18n.test.ts). Everything that needs React lives
// in index.tsx.
//
// See docs/tasks/2026-08-27-i18n-zh-tw.md §2.
import type { Catalog, MessageKey } from "./messages/en/index.ts";

export type Locale = "en" | "zh-TW";

export const SUPPORTED_LOCALES = ["en", "zh-TW"] as const;

// DEFAULT_LOCALE is also the fallback language for missing keys, and is what
// the server renders. It must stay "en": en.ts is the only catalog the type
// system guarantees is complete.
export const DEFAULT_LOCALE: Locale = "en";

// Device-scoped, not account-scoped: a coach signing in on a second device
// sets their language again. Deliberate — see the task doc's "Backward
// compatibility". This key is therefore *not* cleared by
// clearAccountScopedLocalState() on account deletion; the next person to use
// the browser keeps the interface language they can read.
export const LOCALE_STORAGE_KEY = "pumploop.locale";

// Each language is named in itself, never translated. Someone who has landed
// in a language they cannot read needs to find their own on this list.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-TW": "繁體中文",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// detectLocale resolves the active locale from its two inputs, in the
// precedence the task doc fixes:
//   1. an explicit stored choice — always wins, including a stored "en" on a
//      zh browser, which is the whole point of an explicit choice;
//   2. the browser's language list, first entry that looks Chinese;
//   3. English.
//
// Written against plain values rather than reading localStorage/navigator
// itself so the precedence is testable without a DOM.
export function detectLocale(input: { stored?: string | null; languages?: readonly string[] }): Locale {
  if (isLocale(input.stored)) return input.stored;

  for (const language of input.languages ?? []) {
    // Any zh-* tag maps to zh-TW: zh-Hans users are not a pilot audience yet,
    // and Traditional Chinese is closer for them than English is. Revisit if
    // a Simplified catalog is ever added — this line is the whole decision.
    if (typeof language === "string" && language.toLowerCase().startsWith("zh")) return "zh-TW";
  }

  return DEFAULT_LOCALE;
}

// readStoredLocale / writeStoredLocale wrap localStorage the way the rest of
// this app does (lib/account-deletion.ts, calendar's workout-draft.ts):
// guarded for SSR and swallowing quota/private-mode throws, because a
// language preference is never worth breaking a render over.
export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore quota / private-mode failures
  }
}

// localeBootstrapScript returns the inline <head> script that sets
// <html lang> before the browser's first paint.
//
// Next 16's "preventing flash before hydration" guide
// (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md)
// is explicit that a useEffect correction runs after paint. For a *string*
// that is a brief flash of English and unavoidable under this task's chosen
// architecture (no server-side locale mechanism — task doc §2, Option 4).
// For <html lang> it is worse than a flash: the attribute drives CJK font
// fallback and the voice a screen reader picks, so a late correction means
// the page is painted in a Latin fallback font and, briefly, announced as
// English. An attribute, unlike page text, *can* be fixed before paint, so
// it is.
//
// Built from the same constants the React path uses, so the storage key, the
// supported set and the zh rule cannot drift between the two — i18n.test.ts
// executes this string and asserts it agrees with detectLocale().
export function localeBootstrapScript(): string {
  const supported = JSON.stringify(SUPPORTED_LOCALES);
  return (
    `(function(){try{` +
    `var s=localStorage.getItem(${JSON.stringify(LOCALE_STORAGE_KEY)});` +
    `var l=${supported}.indexOf(s)>=0?s:null;` +
    `if(!l){var n=navigator.languages||[navigator.language||""];` +
    `for(var i=0;i<n.length;i++){if(String(n[i]).toLowerCase().indexOf("zh")===0){l="zh-TW";break}}}` +
    `document.documentElement.lang=l||${JSON.stringify(DEFAULT_LOCALE)};` +
    // Swallowed on purpose: localStorage throws in private mode and under
    // "block third-party cookies" in an embedded WebView. The page then
    // keeps the server's lang="en", which is the same outcome as having no
    // script at all — never a blank page.
    `}catch(e){}})()`
  );
}

// Vars interpolate into a message with {name} placeholders. Kept deliberately
// dumb: no plurals, no dates, no nesting. Dates go through
// Intl.DateTimeFormat(locale, …) (decision D3), not through here.
export type MessageVars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(message: string, vars?: MessageVars): string {
  if (!vars) return message;
  return message.replace(PLACEHOLDER, (placeholder, name: string) =>
    // An unsupplied placeholder is left verbatim rather than blanked, so a
    // missed variable reads as the bug it is instead of a plausible sentence
    // with a hole in it.
    name in vars ? String(vars[name]) : placeholder,
  );
}

// translate looks a key up in the active catalog, then in English, then gives
// back the key itself. The English step is what lets a partial or broken
// zh-TW catalog degrade to a readable screen instead of a wall of dotted
// keys; the key step means a genuinely unknown key is obvious in QA rather
// than rendering as empty space.
export function translate(
  catalogs: Record<Locale, Catalog>,
  locale: Locale,
  key: MessageKey,
  vars?: MessageVars,
): string {
  const message = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE]?.[key];
  return message === undefined ? key : interpolate(message, vars);
}
