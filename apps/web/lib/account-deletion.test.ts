import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "./api.ts";
import {
  AccountDeletionError,
  clearAccountScopedLocalState,
  deleteCurrentAccount,
  deleteMeRequestBody,
  deletionReauthKind,
  isAppleLinked,
  isSilentDeletionCancellation,
  sameFirebaseUser,
  settingsAccessibleToRole,
  settingsExitHref,
  userFacingDeletionError,
  type AccountDeletionDeps,
  type FirebaseUserLike,
} from "./account-deletion.ts";

function user(overrides: Partial<FirebaseUserLike> & { providerIds: string[] }): FirebaseUserLike {
  return {
    uid: overrides.uid ?? "uid-1",
    email: overrides.email ?? "a@example.com",
    providerData: overrides.providerIds.map((providerId) => ({ providerId })),
    getIdToken: overrides.getIdToken ?? (async (forceRefresh?: boolean) => {
      assert.equal(forceRefresh, true);
      return "fresh-token";
    }),
  };
}

function deps(overrides: Partial<AccountDeletionDeps> & { current: FirebaseUserLike }): AccountDeletionDeps & {
  deleteCalls: Array<{ token: string; body?: { appleAuthorizationCode: string } }>;
  reauthCalls: unknown[];
  counters: { googleReauthCalls: number; signedOut: boolean };
} {
  const { current, ...rest } = overrides;
  const deleteCalls: Array<{ token: string; body?: { appleAuthorizationCode: string } }> = [];
  const reauthCalls: unknown[] = [];
  const counters = { googleReauthCalls: 0, signedOut: false };
  const implemented: AccountDeletionDeps = {
    getCurrentUser: () => current,
    isNativePlatform: () => true,
    reauthenticateWithCredential: async (_user, credential) => {
      reauthCalls.push(credential);
      return { user: { uid: current.uid } };
    },
    reauthenticateGoogle: async () => {
      counters.googleReauthCalls += 1;
      return { user: { uid: current.uid } };
    },
    appleDeletionMaterial: async () => ({ credential: { apple: true }, authorizationCode: "apple-code" }),
    emailAuthCredential: (email, password) => ({ email, password }),
    promptPassword: async () => "secret",
    deleteMe: async (idToken, body) => {
      deleteCalls.push({ token: idToken, body });
    },
    signOut: async () => {
      counters.signedOut = true;
    },
    clearAccountLocalState: () => {},
    ...rest,
  };
  return Object.assign(implemented, { deleteCalls, reauthCalls, counters });
}

test("Settings is reachable for Coach and Athlete", () => {
  assert.equal(settingsAccessibleToRole("COACH"), true);
  assert.equal(settingsAccessibleToRole("ATHLETE"), true);
  assert.equal(settingsExitHref("COACH"), "/coach/calendar");
  assert.equal(settingsExitHref("ATHLETE"), "/today");
});

test("Apple-linked takes the Apple re-auth path even when Google is also linked", () => {
  assert.equal(deletionReauthKind(["google.com", "apple.com"], true), "apple");
  assert.equal(isAppleLinked(["google.com", "apple.com"]), true);
  assert.equal(deletionReauthKind(["google.com"], true), "google");
  assert.equal(deletionReauthKind(["password"], true), "password");
  assert.equal(deletionReauthKind(["apple.com"], false), "apple-requires-ios");
});

test("non-Apple DELETE sends no Apple code", () => {
  assert.equal(deleteMeRequestBody(false, "should-not-send"), undefined);
  assert.equal(deleteMeRequestBody(false, undefined), undefined);
  assert.deepEqual(deleteMeRequestBody(true, "c-1"), { appleAuthorizationCode: "c-1" });
});

test("Apple cancellation is silent and does not delete", async () => {
  const d = deps({
    current: user({ providerIds: ["apple.com"] }),
    appleDeletionMaterial: async () => {
      const err = new Error("Sign in with Apple was cancelled");
      err.name = "NativeAppleCancelledError";
      throw err;
    },
  });
  assert.equal(await deleteCurrentAccount(d), "cancelled");
  assert.equal(d.deleteCalls.length, 0);
  assert.equal(d.counters.signedOut, false);
});

test("destructive confirmation cancellation is represented as promptPassword null → no DELETE", async () => {
  const d = deps({
    current: user({ providerIds: ["password"] }),
    promptPassword: async () => null,
  });
  assert.equal(await deleteCurrentAccount(d), "cancelled");
  assert.equal(d.deleteCalls.length, 0);
});

test("Apple deletion uses reauthenticateWithCredential and sends the code only after success", async () => {
  const order: string[] = [];
  const d = deps({
    current: user({ providerIds: ["apple.com"] }),
    reauthenticateWithCredential: async (_user, credential) => {
      order.push("reauth");
      assert.deepEqual(credential, { apple: true });
      return { user: { uid: "uid-1" } };
    },
    appleDeletionMaterial: async () => {
      order.push("sheet");
      return { credential: { apple: true }, authorizationCode: "unused-code" };
    },
    deleteMe: async (token, body) => {
      order.push("delete");
      assert.equal(token, "fresh-token");
      assert.deepEqual(body, { appleAuthorizationCode: "unused-code" });
    },
  });
  assert.equal(await deleteCurrentAccount(d), "deleted");
  assert.deepEqual(order, ["sheet", "reauth", "delete"]);
  assert.equal(d.counters.signedOut, true);
});

test("linked Apple + Google still uses Apple deletion path", async () => {
  let appleSheet = false;
  let googleReauth = 0;
  const d = deps({
    current: user({ providerIds: ["google.com", "apple.com"] }),
    appleDeletionMaterial: async () => {
      appleSheet = true;
      return { credential: { apple: true }, authorizationCode: "unused-code" };
    },
    reauthenticateGoogle: async () => {
      googleReauth += 1;
      return { user: { uid: "uid-1" } };
    },
  });
  await deleteCurrentAccount(d);
  assert.equal(appleSheet, true);
  assert.equal(googleReauth, 0);
  assert.deepEqual(d.deleteCalls[0]?.body, { appleAuthorizationCode: "unused-code" });
});

test("Google-only account re-authenticates the current user and omits Apple code", async () => {
  const d = deps({
    current: user({ providerIds: ["google.com"] }),
  });
  await deleteCurrentAccount(d);
  assert.equal(d.counters.googleReauthCalls, 1);
  assert.equal(d.reauthCalls.length, 0);
  assert.equal(d.deleteCalls[0]?.body, undefined);
  assert.equal(d.deleteCalls[0]?.token, "fresh-token");
});

test("Google re-auth cancellation → no DELETE, remain signed in", async () => {
  const d = deps({
    current: user({ providerIds: ["google.com"] }),
    reauthenticateGoogle: async () => {
      const err = new Error("Google sign-in was cancelled");
      err.name = "NativeGoogleCancelledError";
      throw err;
    },
  });
  assert.equal(await deleteCurrentAccount(d), "cancelled");
  assert.equal(d.deleteCalls.length, 0);
  assert.equal(d.counters.signedOut, false);
});

test("Google web popup dismissal → no DELETE, remain signed in", async () => {
  const d = deps({
    current: user({ providerIds: ["google.com"] }),
    reauthenticateGoogle: async () => {
      const err = new Error("The popup has been closed by the user");
      (err as { code?: string }).code = "auth/popup-closed-by-user";
      throw err;
    },
  });
  assert.equal(await deleteCurrentAccount(d), "cancelled");
  assert.equal(d.deleteCalls.length, 0);
  assert.equal(d.counters.signedOut, false);
});

test("re-auth failure → no DELETE and remain signed in", async () => {
  const d = deps({
    current: user({ providerIds: ["apple.com"] }),
    reauthenticateWithCredential: async () => {
      throw new Error("network");
    },
  });
  await assert.rejects(() => deleteCurrentAccount(d));
  assert.equal(d.deleteCalls.length, 0);
  assert.equal(d.counters.signedOut, false);
});

test("uid mismatch after Apple re-auth → no DELETE", async () => {
  const d = deps({
    current: user({ providerIds: ["apple.com"] }),
    reauthenticateWithCredential: async () => ({ user: { uid: "other-uid" } }),
  });
  await assert.rejects(() => deleteCurrentAccount(d));
  assert.equal(d.deleteCalls.length, 0);
  assert.equal(d.counters.signedOut, false);
});

test("fresh ID token is forced after re-auth before DELETE", async () => {
  const refreshes: Array<boolean | undefined> = [];
  const current = user({
    providerIds: ["google.com"],
    getIdToken: async (forceRefresh?: boolean) => {
      refreshes.push(forceRefresh);
      return "fresh-token";
    },
  });
  const d = deps({ current });
  await deleteCurrentAccount(d);
  assert.deepEqual(refreshes, [true]);
});

test("204 clears local auth (signOut) after DELETE", async () => {
  const d = deps({ current: user({ providerIds: ["google.com"] }) });
  assert.equal(await deleteCurrentAccount(d), "deleted");
  assert.equal(d.deleteCalls.length, 1);
  assert.equal(d.counters.signedOut, true);
});

test("400 remains signed in and is retryable", async () => {
  const d = deps({
    current: user({ providerIds: ["apple.com"] }),
    deleteMe: async () => {
      throw new ApiError(400, "invalid", "INVALID_ARGUMENT");
    },
  });
  await assert.rejects(() => deleteCurrentAccount(d), (err: unknown) => {
    assert.equal(err instanceof AccountDeletionError, true);
    assert.equal((err as AccountDeletionError).retryable, true);
    return true;
  });
  assert.equal(d.counters.signedOut, false);
});

test("403 RECENT_AUTH_REQUIRED remains signed in", async () => {
  const d = deps({
    current: user({ providerIds: ["google.com"] }),
    deleteMe: async () => {
      throw new ApiError(403, "recent auth", "RECENT_AUTH_REQUIRED");
    },
  });
  await assert.rejects(() => deleteCurrentAccount(d), (err: unknown) => {
    assert.match(userFacingDeletionError(err).message, /confirm it's you/i);
    return true;
  });
  assert.equal(d.counters.signedOut, false);
});

test("network/500 remains signed in", async () => {
  const d = deps({
    current: user({ providerIds: ["google.com"] }),
    deleteMe: async () => {
      throw new ApiError(500, "boom", "INTERNAL");
    },
  });
  await assert.rejects(() => deleteCurrentAccount(d));
  assert.equal(d.counters.signedOut, false);
});

test("sameFirebaseUser rejects empty or switched identities", () => {
  assert.equal(sameFirebaseUser("a", "a"), true);
  assert.equal(sameFirebaseUser("a", "b"), false);
  assert.equal(sameFirebaseUser("", ""), false);
});

test("isSilentDeletionCancellation covers Apple and Google sheet dismissals", () => {
  const apple = new Error("Sign in with Apple was cancelled");
  apple.name = "NativeAppleCancelledError";
  const google = new Error("Google sign-in was cancelled");
  google.name = "NativeGoogleCancelledError";
  assert.equal(isSilentDeletionCancellation(apple), true);
  assert.equal(isSilentDeletionCancellation(google), true);
  assert.equal(isSilentDeletionCancellation({ code: "auth/popup-closed-by-user" }), true);
  assert.equal(isSilentDeletionCancellation(new Error("network")), false);
});

test("clearAccountScopedLocalState removes the coach draft key", () => {
  const data = new Map([["performance-coach:workout-builder-draft:uid-1", "{}"]]);
  (globalThis as { window: { localStorage: { removeItem: (key: string) => void } } }).window = {
    localStorage: {
      removeItem(key: string) {
        data.delete(key);
      },
    },
  };
  clearAccountScopedLocalState("uid-1");
  assert.equal(data.has("performance-coach:workout-builder-draft:uid-1"), false);
});
