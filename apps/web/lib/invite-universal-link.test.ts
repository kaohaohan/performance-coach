import test from "node:test";
import assert from "node:assert/strict";
import { parseInviteUniversalLink } from "./invite-universal-link";

test("accepts only production HTTPS invite links and discards query/fragment", () => {
  assert.equal(
    parseInviteUniversalLink("https://dontworkout.vercel.app/join/K7M2Q9XR4T?source=share#x"),
    "/join/K7M2Q9XR4T",
  );
});

test("rejects non-production, non-HTTPS, malformed, and ambiguous codes", () => {
  for (const value of [
    "http://dontworkout.vercel.app/join/K7M2Q9XR4T",
    "https://staging.dontworkout.vercel.app/join/K7M2Q9XR4T",
    "https://dontworkout.vercel.app/join/K7M2Q9XR4",
    "https://dontworkout.vercel.app/join/K7M2Q9XR4U",
    "https://dontworkout.vercel.app/join/k7M2Q9XR4T",
    "https://dontworkout.vercel.app/join/K7M2Q9XR4T/extra",
  ]) assert.equal(parseInviteUniversalLink(value), null, value);
});
