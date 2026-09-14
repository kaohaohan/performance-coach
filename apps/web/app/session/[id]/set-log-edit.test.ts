import assert from "node:assert/strict";
import test from "node:test";
import { editPayload, editValuesForLog } from "./set-log-edit";

test("prefills and builds an edit payload", () => {
  const values = editValuesForLog({ reps: 5, load: 60, unit: "kg", rpe: 8 });
  assert.deepEqual(values, { reps: "5", load: "60", unit: "kg", rpe: "8" });
  assert.deepEqual(editPayload(values), { reps: 5, load: 60, unit: "kg", rpe: 8 });
});
test("serializes cleared optional actual values as null", () => {
  assert.deepEqual(editPayload({ reps: "5", load: "", unit: "lb", rpe: "" }), { reps: 5, load: null, unit: null, rpe: null });
  assert.deepEqual(editPayload({ reps: "5", load: "", unit: "kg", rpe: "" }), { reps: 5, load: null, unit: null, rpe: null });
});
test("rejects invalid edits", () => {
  assert.deepEqual(editPayload({ reps: "0", load: "", unit: "kg", rpe: "" }), { error: "reps" });
  assert.deepEqual(editPayload({ reps: "2", load: "-1", unit: "kg", rpe: "" }), { error: "load" });
  assert.deepEqual(editPayload({ reps: "2", load: "", unit: "kg", rpe: "11" }), { error: "rpe" });
});
