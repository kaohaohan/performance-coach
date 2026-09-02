// /settings. Only the language selector exists so far; the rest of the page
// is converted in sub-task 5.
export const settings = {
  "settings.language.heading": "Language",
  "settings.language.description": "Applies to this device only.",
  "settings.language.label": "Interface language",
} as const;

export type SettingsMessages = Record<keyof typeof settings, string>;
