// In-app account deletion (Guideline 5.1.1(v)). Orchestrates
// reauthenticateWithCredential on the current Firebase user, then
// DELETE /api/v1/me. See docs/tasks/2026-08-26-account-deletion.md.
//
// Every failure this module reports carries a message-catalog key rather than
// an English sentence (sub-task 6d of docs/tasks/2026-08-27-i18n-zh-tw.md).
// Deletion was the last flow that stayed English in a 繁體中文 app, and it is
// the worst one to leave that way: it is the flow Apple review re-walks, and
// a person who cannot read the failure cannot tell whether their account was
// deleted.
//
// The imports below are deliberately type-only plus one constant, all from
// `.ts` files: this module must stay React-free, because `node --test` strips
// TypeScript types but cannot parse JSX, and importing lib/i18n/index.tsx
// would make account-deletion.test.ts unloadable.
import { BRAND_NAME } from "./brand.ts";
import type { MessageVars } from "./i18n/locale.ts";
import type { MessageKey } from "./i18n/messages/en/index.ts";

export type DeletionReauthKind = "apple" | "google" | "password" | "apple-requires-ios" | "unsupported";

export type FirebaseUserLike = {
  uid: string;
  email: string | null;
  providerData: Array<{ providerId: string }>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type AccountDeletionDeps = {
  getCurrentUser: () => FirebaseUserLike | null;
  isNativePlatform: () => boolean;
  reauthenticateWithCredential: (user: FirebaseUserLike, credential: unknown) => Promise<{ user: { uid: string } }>;
  reauthenticateGoogle: (user: FirebaseUserLike) => Promise<{ user: { uid: string } }>;
  appleDeletionMaterial: () => Promise<{ credential: unknown; authorizationCode: string }>;
  emailAuthCredential: (email: string, password: string) => unknown;
  promptPassword: () => Promise<string | null>;
  deleteMe: (idToken: string, body?: { appleAuthorizationCode: string }) => Promise<void>;
  signOut: () => Promise<void>;
  clearAccountLocalState: (uid: string) => void;
};

// AccountDeletionError carries what to say, not the saying of it: `messageKey`
// is a key in the shared catalog and the call site renders it with useT()'s
// `t(key, vars)`. Error.message is set to the key too — it is never shown to
// anyone, but it keeps stack traces and test failures readable.
//
// `retryable` is unchanged and still the second signal this type carries: the
// apple-requires-ios refusal is the one failure trying again cannot fix.
export class AccountDeletionError extends Error {
  readonly messageKey: MessageKey;
  readonly messageVars?: MessageVars;
  retryable: boolean;
  constructor(messageKey: MessageKey, retryable = true, messageVars?: MessageVars) {
    super(messageKey);
    this.name = "AccountDeletionError";
    this.messageKey = messageKey;
    this.messageVars = messageVars;
    this.retryable = retryable;
  }
}

export function providerIds(user: { providerData: Array<{ providerId: string }> }): string[] {
  return user.providerData.map((entry) => entry.providerId);
}

export function isAppleLinked(ids: readonly string[]): boolean {
  return ids.includes("apple.com");
}

export function settingsExitHref(role: "COACH" | "ATHLETE"): string {
  return role === "COACH" ? "/coach/calendar" : "/today";
}

export function settingsAccessibleToRole(role: "COACH" | "ATHLETE"): boolean {
  return role === "COACH" || role === "ATHLETE";
}

// Apple-linked always wins: backend DELETE requires appleAuthorizationCode
// whenever firebase identities include apple.com, even if the last sign-in
// was Google.
export function deletionReauthKind(ids: readonly string[], nativePlatform: boolean): DeletionReauthKind {
  if (isAppleLinked(ids)) {
    return nativePlatform ? "apple" : "apple-requires-ios";
  }
  if (ids.includes("google.com")) return "google";
  if (ids.includes("password")) return "password";
  return "unsupported";
}

export function deleteMeRequestBody(
  appleLinked: boolean,
  authorizationCode: string | undefined,
): { appleAuthorizationCode: string } | undefined {
  if (!appleLinked) return undefined;
  const code = authorizationCode?.trim() ?? "";
  if (code === "") {
    throw new AccountDeletionError("errors.deletion.appleCodeMissing");
  }
  return { appleAuthorizationCode: code };
}

export function sameFirebaseUser(expectedUid: string, actualUid: string): boolean {
  return expectedUid !== "" && expectedUid === actualUid;
}

export function isSilentDeletionCancellation(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NativeAppleCancelledError" || name === "NativeGoogleCancelledError") {
    return true;
  }
  const code = (err as { code?: string } | null)?.code;
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/user-cancelled" ||
    code === "auth/cancelled-popup-request"
  );
}

function isApiErrorShape(err: unknown): err is { status: number; code?: string } {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { status?: unknown; code?: unknown };
  return typeof candidate.status === "number";
}

export function userFacingDeletionError(err: unknown): AccountDeletionError {
  if (err instanceof AccountDeletionError) return err;
  if (isApiErrorShape(err)) {
    if (err.code === "RECENT_AUTH_REQUIRED" || err.status === 403) {
      return new AccountDeletionError("errors.deletion.recentAuthRequired");
    }
    if (err.status === 400 || err.code === "INVALID_ARGUMENT") {
      return new AccountDeletionError("errors.deletion.invalidRequest");
    }
    return new AccountDeletionError("errors.deletion.failed");
  }
  return new AccountDeletionError("errors.deletion.failed");
}

const DRAFT_PREFIX = "performance-coach:workout-builder-draft:";

export function clearAccountScopedLocalState(firebaseUid: string): void {
  if (typeof window === "undefined" || firebaseUid === "") return;
  try {
    window.localStorage.removeItem(`${DRAFT_PREFIX}${firebaseUid}`);
  } catch {
    // ignore quota / private-mode failures
  }
}

export async function deleteCurrentAccount(deps: AccountDeletionDeps): Promise<"deleted" | "cancelled"> {
  const user = deps.getCurrentUser();
  if (!user) {
    throw new AccountDeletionError("errors.deletion.signedOut");
  }
  const expectedUid = user.uid;
  const ids = providerIds(user);
  const appleLinked = isAppleLinked(ids);
  const kind = deletionReauthKind(ids, deps.isNativePlatform());

  if (kind === "apple-requires-ios") {
    throw new AccountDeletionError("errors.deletion.appleRequiresIos", false, { app: BRAND_NAME });
  }
  if (kind === "unsupported") {
    throw new AccountDeletionError("errors.deletion.reauthFailed");
  }

  let appleAuthorizationCode: string | undefined;
  try {
    if (kind === "apple") {
      const material = await deps.appleDeletionMaterial();
      const result = await deps.reauthenticateWithCredential(user, material.credential);
      if (!sameFirebaseUser(expectedUid, result.user.uid)) {
        throw new AccountDeletionError("errors.deletion.reauthFailed");
      }
      appleAuthorizationCode = material.authorizationCode;
    } else if (kind === "google") {
      const result = await deps.reauthenticateGoogle(user);
      if (!sameFirebaseUser(expectedUid, result.user.uid)) {
        throw new AccountDeletionError("errors.deletion.reauthFailed");
      }
    } else {
      const password = await deps.promptPassword();
      if (password === null) return "cancelled";
      if (!user.email) {
        throw new AccountDeletionError("errors.deletion.reauthFailed");
      }
      const credential = deps.emailAuthCredential(user.email, password);
      const result = await deps.reauthenticateWithCredential(user, credential);
      if (!sameFirebaseUser(expectedUid, result.user.uid)) {
        throw new AccountDeletionError("errors.deletion.reauthFailed");
      }
    }
  } catch (err) {
    if (isSilentDeletionCancellation(err)) return "cancelled";
    throw userFacingDeletionError(err);
  }

  const still = deps.getCurrentUser();
  if (!still || !sameFirebaseUser(expectedUid, still.uid)) {
    throw new AccountDeletionError("errors.deletion.reauthFailed");
  }

  const body = deleteMeRequestBody(appleLinked, appleAuthorizationCode);
  const idToken = await still.getIdToken(true);

  try {
    await deps.deleteMe(idToken, body);
  } catch (err) {
    throw userFacingDeletionError(err);
  }

  deps.clearAccountLocalState(expectedUid);
  await deps.signOut();
  return "deleted";
}
