import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../api.ts";
import {
  APPLE_AUTH_POLICY,
  COMMON_AUTH_CODES,
  GOOGLE_AUTH_POLICY,
  PASSWORD_AUTH_CODES,
  SILENT,
  errorMessage,
  resolveError,
  untranslatedErrorMessage,
  type ErrorPolicy,
} from "./errors.ts";
import { en, type MessageKey } from "./messages/en/index.ts";

// firebaseError builds what the Firebase SDK actually throws: an Error whose
// `code` carries the meaning. Only `code` and `name` are read.
function firebaseError(code: string): unknown {
  return Object.assign(new Error(code), { code });
}

function keyOf(err: unknown, policy?: ErrorPolicy): MessageKey | null {
  const resolved = resolveError(err, policy);
  return resolved.kind === "key" ? resolved.key : null;
}

// --- the shape every screen shares -----------------------------------

test("an unrecognised failure falls back to the generic message", () => {
  assert.deepEqual(resolveError(new Error("boom")), { kind: "key", key: "errors.unexpected" });
});

test("a policy fallback replaces the generic one", () => {
  assert.deepEqual(resolveError(new Error("boom"), { fallback: "errors.google.failed" }), {
    kind: "key",
    key: "errors.google.failed",
  });
});

test("a non-Error throw never throws again inside the error handler", () => {
  // A catch block receives whatever was thrown. Each of these used to reach
  // `(err as {code?: string}).code` in fourteen separate helpers.
  for (const thrown of [null, undefined, "boom", 42, Symbol("boom"), { code: 7 }]) {
    assert.deepEqual(resolveError(thrown), { kind: "key", key: "errors.unexpected" });
  }
});

// --- ApiError passthrough (the eight identical page helpers) ----------

test("serverMessage passes the API's own explanation through", () => {
  const err = new ApiError(422, "Scheduled workout already started.", "CONFLICT");
  assert.deepEqual(resolveError(err, { serverMessage: true }), {
    kind: "text",
    text: "Scheduled workout already started.",
  });
});

test("without serverMessage an ApiError is just an error", () => {
  const err = new ApiError(500, "Request failed (500)");
  assert.deepEqual(resolveError(err), { kind: "key", key: "errors.unexpected" });
});

test("an empty API message falls back rather than showing a blank alert", () => {
  assert.deepEqual(resolveError(new ApiError(500, "   "), { serverMessage: true }), {
    kind: "key",
    key: "errors.unexpected",
  });
});

test("a status the screen explains itself beats the API's message", () => {
  // /coach/signup's 409: the backend never promotes ATHLETE to COACH, and the
  // page says so in its own words rather than showing a bare conflict.
  const policy: ErrorPolicy = {
    serverMessage: true,
    statuses: { 409: "errors.auth.emailInUse" },
  };
  assert.equal(keyOf(new ApiError(409, "user already exists"), policy), "errors.auth.emailInUse");
  assert.deepEqual(resolveError(new ApiError(400, "bad request"), policy), {
    kind: "text",
    text: "bad request",
  });
});

test("a non-ApiError is not mistaken for a server response", () => {
  assert.deepEqual(resolveError(new Error("offline"), { serverMessage: true }), {
    kind: "key",
    key: "errors.unexpected",
  });
});

// --- shared vs opt-in Firebase codes ---------------------------------

test("provider-agnostic auth codes resolve without any policy", () => {
  assert.equal(keyOf(firebaseError("auth/network-request-failed")), "errors.network");
  assert.equal(keyOf(firebaseError("auth/too-many-requests")), "errors.auth.tooManyRequests");
  assert.equal(keyOf(firebaseError("auth/user-disabled")), "errors.auth.userDisabled");
});

test("password-form codes are opt-in, not automatic", () => {
  // The regression this guards: applying the password table everywhere would
  // put "Incorrect email or password." on a failed Google popup.
  assert.equal(keyOf(firebaseError("auth/wrong-password")), "errors.unexpected");
  const policy: ErrorPolicy = { codes: { ...PASSWORD_AUTH_CODES }, fallback: "errors.auth.signInFailed" };
  assert.equal(keyOf(firebaseError("auth/wrong-password"), policy), "errors.auth.invalidCredentials");
  assert.equal(keyOf(firebaseError("auth/user-not-found"), policy), "errors.auth.invalidCredentials");
  assert.equal(keyOf(firebaseError("auth/invalid-credential"), policy), "errors.auth.invalidCredentials");
  assert.equal(keyOf(firebaseError("auth/invalid-email"), policy), "errors.auth.invalidEmail");
  assert.equal(keyOf(firebaseError("auth/email-already-in-use"), policy), "errors.auth.emailInUse");
  assert.equal(keyOf(firebaseError("auth/weak-password"), policy), "errors.auth.weakPassword");
  // Still reaches the shared table, and still reaches its own fallback.
  assert.equal(keyOf(firebaseError("auth/too-many-requests"), policy), "errors.auth.tooManyRequests");
  assert.equal(keyOf(firebaseError("auth/internal-error"), policy), "errors.auth.signInFailed");
});

test("a policy code overrides the shared table", () => {
  const policy: ErrorPolicy = { codes: { "auth/user-disabled": "errors.google.unavailable" } };
  assert.equal(keyOf(firebaseError("auth/user-disabled"), policy), "errors.google.unavailable");
});

// --- Google -----------------------------------------------------------

test("backing out of Google sign-in shows nothing", () => {
  for (const code of ["auth/popup-closed-by-user", "auth/user-cancelled", "auth/cancelled-popup-request"]) {
    assert.deepEqual(resolveError(firebaseError(code), GOOGLE_AUTH_POLICY), { kind: "silent" }, code);
  }
  // The native iOS sheet reports a cancel as a sentinel name, not a code.
  const cancelled = Object.assign(new Error("cancelled"), { name: "NativeGoogleCancelledError" });
  assert.deepEqual(resolveError(cancelled, GOOGLE_AUTH_POLICY), { kind: "silent" });
});

test("Google maps its own codes and falls back to Google copy", () => {
  assert.equal(keyOf(firebaseError("auth/popup-blocked"), GOOGLE_AUTH_POLICY), "errors.google.popupBlocked");
  assert.equal(
    keyOf(firebaseError("auth/web-storage-unsupported"), GOOGLE_AUTH_POLICY),
    "errors.google.webStorageUnsupported",
  );
  assert.equal(
    keyOf(firebaseError("auth/account-exists-with-different-credential"), GOOGLE_AUTH_POLICY),
    "errors.google.accountExists",
  );
  for (const code of ["auth/operation-not-allowed", "auth/unauthorized-domain", "auth/auth-domain-config-required"]) {
    assert.equal(keyOf(firebaseError(code), GOOGLE_AUTH_POLICY), "errors.google.unavailable", code);
  }
  assert.equal(keyOf(firebaseError("auth/internal-error"), GOOGLE_AUTH_POLICY), "errors.google.failed");
  assert.equal(keyOf(firebaseError("auth/network-request-failed"), GOOGLE_AUTH_POLICY), "errors.network");
});

// --- Apple ------------------------------------------------------------

test("backing out of the Apple sheet shows nothing", () => {
  const cancelled = Object.assign(new Error("cancelled"), { name: "NativeAppleCancelledError" });
  assert.deepEqual(resolveError(cancelled, APPLE_AUTH_POLICY), { kind: "silent" });
  // A Google sentinel is not an Apple cancellation and must not be swallowed.
  const other = Object.assign(new Error("cancelled"), { name: "NativeGoogleCancelledError" });
  assert.equal(keyOf(other, APPLE_AUTH_POLICY), "errors.apple.failed");
});

test("Apple keeps its own account-collision wording", () => {
  // Deliberately not errors.google.accountExists: on iOS the method that owns
  // the account is not necessarily email and password.
  assert.equal(
    keyOf(firebaseError("auth/account-exists-with-different-credential"), APPLE_AUTH_POLICY),
    "errors.apple.accountExists",
  );
  assert.notEqual(en["errors.apple.accountExists"], en["errors.google.accountExists"]);
});

test("Apple reads auth/invalid-credential as a misconfiguration, not a bad password", () => {
  for (const code of ["auth/operation-not-allowed", "auth/configuration-not-found", "auth/invalid-credential"]) {
    assert.equal(keyOf(firebaseError(code), APPLE_AUTH_POLICY), "errors.apple.unavailable", code);
  }
  assert.equal(keyOf(firebaseError("auth/internal-error"), APPLE_AUTH_POLICY), "errors.apple.failed");
});

// --- the string-producing wrappers ------------------------------------

test("errorMessage translates keys, passes server text through and stays silent", () => {
  const t = (key: MessageKey) => `zh:${key}`;
  assert.equal(errorMessage(t, new Error("boom")), "zh:errors.unexpected");
  assert.equal(errorMessage(t, new ApiError(400, "no room"), { serverMessage: true }), "no room");
  assert.equal(errorMessage(t, firebaseError("auth/popup-closed-by-user"), GOOGLE_AUTH_POLICY), null);
});

test("untranslatedErrorMessage is the English catalog, verbatim", () => {
  assert.equal(untranslatedErrorMessage(new Error("boom")), en["errors.unexpected"]);
  assert.equal(
    untranslatedErrorMessage(firebaseError("auth/popup-blocked"), GOOGLE_AUTH_POLICY),
    en["errors.google.popupBlocked"],
  );
  assert.equal(untranslatedErrorMessage(firebaseError("auth/user-cancelled"), GOOGLE_AUTH_POLICY), null);
});

// --- structural ------------------------------------------------------

test("every key a built-in policy can produce exists in the catalog", () => {
  // A key that survives a rename here would render as its own dotted name on
  // a real error screen, where nobody is looking.
  const policies: ErrorPolicy[] = [GOOGLE_AUTH_POLICY, APPLE_AUTH_POLICY];
  const tables = [COMMON_AUTH_CODES, PASSWORD_AUTH_CODES, ...policies.map((p) => p.codes ?? {})];
  const keys = [
    ...tables.flatMap((table) => Object.values(table)),
    ...policies.map((policy) => policy.fallback),
    "errors.unexpected",
  ].filter((value): value is MessageKey => value !== undefined && value !== SILENT);

  const missing = keys.filter((key) => !(key in en));
  assert.deepEqual(missing, [], `not in the catalog: ${missing.join(", ")}`);
});
