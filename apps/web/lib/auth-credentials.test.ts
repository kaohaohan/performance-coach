import assert from "node:assert/strict";
import test from "node:test";
import { isValidEmail, isValidNewPassword } from "./auth-credentials.ts";

test("isValidEmail requires a dotted domain", () => {
  assert.equal(isValidEmail("a@b.com"), true);
  assert.equal(isValidEmail("  a@b.com  "), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail(""), false);
});

test("isValidNewPassword requires 8 characters, a letter, and a number", () => {
  assert.equal(isValidNewPassword("Password1"), true);
  assert.equal(isValidNewPassword("abcd1234"), true);
  assert.equal(isValidNewPassword("short1a"), false);
  assert.equal(isValidNewPassword("password"), false);
  assert.equal(isValidNewPassword("12345678"), false);
});
