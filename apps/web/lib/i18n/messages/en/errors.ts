// Shared error copy. The 14 per-page errorMessage() / *AuthErrorMessage()
// helpers consolidate onto these keys (decision D2 in the task doc).
export const errors = {
  "errors.network": "Couldn't reach the server. Check your connection and try again.",
  "errors.unexpected": "Something went wrong. Please try again.",
} as const;

export type ErrorMessages = Record<keyof typeof errors, string>;
