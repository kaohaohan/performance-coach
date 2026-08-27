import assert from "node:assert/strict";
import test from "node:test";
import {
  appleAuthorizationCodeFromPayload,
  appleInitializeConfig,
  isAppleCancellation,
  NativeAppleCancelledError,
  sha256Hex,
} from "./native-apple-auth.ts";

test("the plugin's stable USER_CANCELLED code classifies as cancellation", () => {
  assert.equal(isAppleCancellation({ code: "USER_CANCELLED" }), true);
});

test("message-only cancellations still classify (mapping drift fallback)", () => {
  assert.equal(
    isAppleCancellation({ message: "The user canceled the sign-in flow" }),
    true,
  );
});

test("real failures are not misclassified as cancellations", () => {
  assert.equal(
    isAppleCancellation({ code: "auth/network-request-failed", message: "network error" }),
    false,
  );
  assert.equal(isAppleCancellation(new Error("Apple returned no identity token")), false);
  assert.equal(isAppleCancellation(null), false);
  assert.equal(isAppleCancellation(undefined), false);
});

test("sha256Hex produces a lowercase hex SHA-256 digest", async () => {
  // Well-known vector: SHA-256("") is e3b0...b855.
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  const digest = await sha256Hex("pumploop-nonce");
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("the cancellation sentinel carries the name the UI matches on", () => {
  const err = new NativeAppleCancelledError();
  assert.equal(err.name, "NativeAppleCancelledError");
  assert.ok(err instanceof Error);
});

test("ordinary Apple login initialize does not enable proper token exchange", () => {
  const config = appleInitializeConfig("login");
  assert.deepEqual(config, { apple: {} });
  assert.equal("useProperTokenExchange" in config.apple, false);
});

test("Apple deletion initialize requests an unused authorization code", () => {
  const config = appleInitializeConfig("deletion");
  assert.equal(config.apple.useProperTokenExchange, true);
  assert.equal("redirectUrl" in config.apple, false);
});

test("appleAuthorizationCodeFromPayload requires a non-empty code", () => {
  assert.equal(appleAuthorizationCodeFromPayload({ authorizationCode: "c-123" }), "c-123");
  assert.throws(() => appleAuthorizationCodeFromPayload({ authorizationCode: "  " }));
  assert.throws(() => appleAuthorizationCodeFromPayload({ idToken: "id-only" }));
});
