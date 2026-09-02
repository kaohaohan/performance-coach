import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  detectLocale,
  isLocale,
  localeBootstrapScript,
  readStoredLocale,
  translate,
  writeStoredLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "./locale.ts";
import { en, type Catalog } from "./messages/en/index.ts";
import { zhTW } from "./messages/zh-TW/index.ts";

const catalogs: Record<Locale, Catalog> = { en, "zh-TW": zhTW };

// --- key parity -------------------------------------------------------

test("zh-TW translates every English key", () => {
  const missing = Object.keys(en).filter((key) => !(key in zhTW));
  assert.deepEqual(missing, [], `zh-TW is missing: ${missing.join(", ")}`);
});

test("zh-TW carries no key English does not define", () => {
  const extra = Object.keys(zhTW).filter((key) => !(key in en));
  assert.deepEqual(extra, [], `zh-TW has stale keys: ${extra.join(", ")}`);
});

test("no message is left as its English source in zh-TW", () => {
  // An untranslated string copied over from en.ts type-checks fine and is
  // invisible in review; it only shows up as English text on a Chinese
  // screen. Punctuation-only values would be legitimate, but the catalog has
  // none today, so any match here is a copy-paste that was never translated.
  const untranslated = (Object.keys(en) as Array<keyof typeof en>).filter((key) => zhTW[key] === en[key]);
  assert.deepEqual(untranslated, [], `still English in zh-TW: ${untranslated.join(", ")}`);
});

test("every supported locale has a catalog and a self-named label", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(catalogs[locale], `no catalog for ${locale}`);
    assert.ok(LOCALE_LABELS[locale], `no label for ${locale}`);
  }
});

// --- detection precedence --------------------------------------------

test("an explicit stored choice beats the browser language", () => {
  assert.equal(detectLocale({ stored: "en", languages: ["zh-TW", "zh"] }), "en");
  assert.equal(detectLocale({ stored: "zh-TW", languages: ["en-US"] }), "zh-TW");
});

test("a Chinese browser language selects zh-TW when nothing is stored", () => {
  assert.equal(detectLocale({ stored: null, languages: ["zh-TW"] }), "zh-TW");
  assert.equal(detectLocale({ stored: null, languages: ["zh-Hant-TW", "en"] }), "zh-TW");
  // Simplified maps to zh-TW too, deliberately — see locale.ts.
  assert.equal(detectLocale({ stored: null, languages: ["zh-CN"] }), "zh-TW");
  // Case-insensitive: navigator.language is not guaranteed lowercase.
  assert.equal(detectLocale({ stored: null, languages: ["ZH-tw"] }), "zh-TW");
});

test("detection falls back to English", () => {
  assert.equal(detectLocale({ stored: null, languages: ["en-US", "ja"] }), DEFAULT_LOCALE);
  assert.equal(detectLocale({ stored: null, languages: [] }), DEFAULT_LOCALE);
  assert.equal(detectLocale({}), DEFAULT_LOCALE);
});

test("a corrupt stored value is ignored, not trusted", () => {
  assert.equal(detectLocale({ stored: "klingon", languages: ["zh-TW"] }), "zh-TW");
  assert.equal(detectLocale({ stored: "", languages: ["en"] }), DEFAULT_LOCALE);
});

test("isLocale accepts exactly the supported locales", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("zh-TW"), true);
  assert.equal(isLocale("zh"), false);
  assert.equal(isLocale("zh-tw"), false);
  assert.equal(isLocale(null), false);
  assert.equal(isLocale(undefined), false);
});

// --- lookup and fallback ---------------------------------------------

test("translate returns the active locale's message", () => {
  assert.equal(translate(catalogs, "zh-TW", "common.save"), zhTW["common.save"]);
  assert.equal(translate(catalogs, "en", "common.save"), "Save");
});

test("a key missing from zh-TW falls back to English, not to the raw key", () => {
  // Built by hand: the real zh-TW catalog is type-checked complete, so the
  // fallback path has no natural input. It still has to work — it is the
  // only safety net for a bad deploy, and the production flip reaches live
  // coaches immediately (task doc §2, Rollout sequencing).
  const partial = { en, "zh-TW": { ...zhTW, "common.save": undefined } as unknown as Catalog };
  assert.equal(translate(partial, "zh-TW", "common.save"), "Save");
});

test("an unknown key renders as itself rather than as empty space", () => {
  const unknown = "calendar.notYetAdded" as keyof Catalog;
  assert.equal(translate(catalogs, "zh-TW", unknown), "calendar.notYetAdded");
});

// --- interpolation ----------------------------------------------------

test("placeholders are filled from vars", () => {
  const withVars: Record<Locale, Catalog> = {
    en: { ...en, "common.save": "Save {count} set for {name}" },
    "zh-TW": { ...zhTW, "common.save": "為 {name} 儲存 {count} 組" },
  };
  assert.equal(
    translate(withVars, "en", "common.save", { name: "Mei", count: 3 }),
    "Save 3 set for Mei",
  );
  assert.equal(
    translate(withVars, "zh-TW", "common.save", { name: "Mei", count: 3 }),
    "為 Mei 儲存 3 組",
  );
});

test("an unsupplied placeholder is left visible", () => {
  const withVars: Record<Locale, Catalog> = {
    en: { ...en, "common.save": "Save for {name}" },
    "zh-TW": zhTW,
  };
  assert.equal(translate(withVars, "en", "common.save", { other: "x" }), "Save for {name}");
});

// --- storage ----------------------------------------------------------

test("readStoredLocale returns null off-browser and when the value is junk", () => {
  const globals = globalThis as { window?: unknown };
  const original = globals.window;
  try {
    delete globals.window;
    assert.equal(readStoredLocale(), null);

    let stored: Record<string, string> = { [LOCALE_STORAGE_KEY]: "nonsense" };
    globals.window = {
      localStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => {
          stored[key] = value;
        },
      },
    };
    assert.equal(readStoredLocale(), null);

    stored = { [LOCALE_STORAGE_KEY]: "zh-TW" };
    assert.equal(readStoredLocale(), "zh-TW");

    writeStoredLocale("en");
    assert.equal(stored[LOCALE_STORAGE_KEY], "en");
  } finally {
    if (original === undefined) delete globals.window;
    else globals.window = original;
  }
});

test("a throwing localStorage never breaks a render", () => {
  const globals = globalThis as { window?: unknown };
  const original = globals.window;
  try {
    globals.window = {
      localStorage: {
        getItem: () => {
          throw new Error("private mode");
        },
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    };
    assert.equal(readStoredLocale(), null);
    assert.doesNotThrow(() => writeStoredLocale("zh-TW"));
  } finally {
    if (original === undefined) delete globals.window;
    else globals.window = original;
  }
});

// --- the inline <head> bootstrap script -------------------------------

// runBootstrap executes the real script string against a fake document /
// localStorage / navigator and gives back the lang it set. The script is
// hand-written vanilla JS living in a template literal, where a typo cannot
// be caught by tsc or eslint — running it is the only way to know it works,
// and comparing it against detectLocale() is the only way to know the two
// paths still agree.
function runBootstrap(input: { stored?: string | null; languages?: string[] } | "throws"): string {
  const documentStub = { documentElement: { lang: "untouched" } };
  const storage =
    input === "throws"
      ? {
          getItem() {
            throw new Error("private mode");
          },
        }
      : { getItem: (key: string) => (key === LOCALE_STORAGE_KEY ? input.stored ?? null : null) };
  const navigatorStub = input === "throws" ? { languages: [] } : { languages: input.languages ?? [] };

  new Function("document", "localStorage", "navigator", localeBootstrapScript())(
    documentStub,
    storage,
    navigatorStub,
  );
  return documentStub.documentElement.lang;
}

test("the bootstrap script agrees with detectLocale on every case", () => {
  const cases: Array<{ stored?: string | null; languages?: string[] }> = [
    { stored: "zh-TW", languages: ["en-US"] },
    { stored: "en", languages: ["zh-TW"] },
    { stored: null, languages: ["zh-TW", "en"] },
    { stored: null, languages: ["zh-Hant-TW"] },
    { stored: null, languages: ["zh-CN"] },
    { stored: null, languages: ["ZH-tw"] },
    { stored: null, languages: ["en-US", "ja"] },
    { stored: null, languages: [] },
    { stored: "klingon", languages: ["zh-TW"] },
    { stored: "", languages: ["en"] },
  ];
  for (const input of cases) {
    assert.equal(
      runBootstrap(input),
      detectLocale(input),
      `script and detectLocale disagree on ${JSON.stringify(input)}`,
    );
  }
});

test("the bootstrap script leaves the server value alone when storage throws", () => {
  // Private mode, or an embedded WebView with site data blocked. The page
  // keeps lang="en" from the server rather than dying on an uncaught error
  // in <head>, which would block parsing of everything after it.
  assert.equal(runBootstrap("throws"), "untouched");
});
