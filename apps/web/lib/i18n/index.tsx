"use client";

// LocaleProvider — the client-side locale context chosen in
// docs/tasks/2026-08-27-i18n-zh-tw.md (Option 4). No routing, no URL change,
// no new dependency: 13 of 15 routes are client components behind Firebase
// auth, so per-locale URLs would buy no SEO while breaking the /join/{code}
// invite links already in circulation.
//
// Locale lives in React state plus localStorage. Changing it re-renders in
// place — no navigation, no reload, no sign-out.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "./messages/en/index";
import { zhTW } from "./messages/zh-TW/index";
import {
  DEFAULT_LOCALE,
  detectLocale,
  readStoredLocale,
  translate,
  writeStoredLocale,
  type Locale,
  type MessageVars,
} from "./locale";
import type { Catalog, MessageKey } from "./messages/en/index";

const catalogs: Record<Locale, Catalog> = { en, "zh-TW": zhTW };

export type Translate = (key: MessageKey, vars?: MessageVars) => string;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Starts at DEFAULT_LOCALE rather than reading localStorage in the
  // initializer, and that is not an oversight: the server renders this tree,
  // so a client-only initial value would differ from the server HTML and
  // React would throw a hydration mismatch across every translated string on
  // the page. The stored/browser locale is applied in the effect below
  // instead, one commit later.
  //
  // The residual cost is a first paint of page *text* in English for a
  // zh-TW user. Unlike <html lang> (fixed before paint by the inline script
  // in app/layout.tsx), text cannot be corrected by a script — only the
  // server knowing the locale would fix it, and that means a cookie or
  // Accept-Language read in the root layout, which opts the whole app out of
  // static prerendering. Task doc §2 rejected exactly that trade. In
  // practice it is mostly hidden: every locale-bearing route is auth-gated
  // and already paints a "Loading…" state while Firebase resolves.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const detected = detectLocale({
      stored: readStoredLocale(),
      languages: typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language],
    });
    // Deferred rather than called straight from the effect body, matching
    // AuthProvider's handling of the same react-hooks/set-state-in-effect
    // rule.
    Promise.resolve().then(() => setLocaleState(detected));
  }, []);

  useEffect(() => {
    // The inline script in app/layout.tsx already set this before first
    // paint. Re-applying it here covers the two cases that script cannot:
    // the user switching language without a reload, and React's Strict Mode
    // remount in development, which resets <html> to the attributes it
    // manages from JSX and so discards the script's value.
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next);
    setLocaleState(next);
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => translate(catalogs, locale, key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale/useT must be used within a LocaleProvider");
  }
  return ctx;
}

// useT is what pages call: const t = useT(); t("common.save").
export function useT(): Translate {
  return useLocaleContext().t;
}

// useLocale is for the two callers that need the locale itself rather than a
// message: the /settings language selector, and Intl.DateTimeFormat(locale)
// under decision D3.
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
}

export { LOCALE_LABELS, SUPPORTED_LOCALES } from "./locale";
export type { Locale } from "./locale";
export type { MessageKey } from "./messages/en/index";
