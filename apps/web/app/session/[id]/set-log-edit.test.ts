import assert from "node:assert/strict";
import test from "node:test";
import { editPayload, editValuesForLog } from "./set-log-edit";

test("prefills and builds an edit payload", () => {
  const values = editValuesForLog({ reps: 5, load: 60, unit: "kg", rir: 8 });
  assert.deepEqual(values, { reps: "5", load: "60", unit: "kg", rir: "8" });
  assert.deepEqual(editPayload(values), { reps: 5, load: 60, unit: "kg", rir: 8 });
});
test("serializes cleared optional actual values as null", () => {
  assert.deepEqual(editPayload({ reps: "5", load: "", unit: "lb", rir: "" }), { reps: 5, load: null, unit: null, rir: null });
  assert.deepEqual(editPayload({ reps: "5", load: "", unit: "kg", rir: "" }), { reps: 5, load: null, unit: null, rir: null });
});
test("rejects invalid edits", () => {
  assert.deepEqual(editPayload({ reps: "0", load: "", unit: "kg", rir: "" }), { error: "reps" });
  assert.deepEqual(editPayload({ reps: "2", load: "-1", unit: "kg", rir: "" }), { error: "load" });
  assert.deepEqual(editPayload({ reps: "2", load: "", unit: "kg", rir: "11" }), { error: "rir" });
});
