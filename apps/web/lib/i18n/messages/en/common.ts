// Strings that already repeat verbatim across pages today.
export const common = {
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
  "common.signOut": "Sign Out",
  "common.signingOut": "Signing out…",
} as const;

export type CommonMessages = Record<keyof typeof common, string>;
