import assert from "node:assert/strict";
import test from "node:test";
import { ExistingExerciseUnavailableError, createOrResolveExercise } from "./exercise-creation.ts";

const createdExercise = { id: "created", name: "Cossack Squat", scope: "PRIVATE" as const };
const existingExercise = { id: "existing", name: "COSSACK SQUAT", scope: "SYSTEM" as const };

test("returns the newly created exercise", async () => {
  const result = await createOrResolveExercise({
    name: "Cossack Squat",
    create: async () => createdExercise,
    search: async () => [],
    isConflict: () => false,
  });

  assert.equal(result, createdExercise);
});

test("resolves a case-insensitive 409 collision to the visible exercise", async () => {
  const conflict = new Error("conflict");
  const result = await createOrResolveExercise({
    name: "Cossack Squat",
    create: async () => { throw conflict; },
    search: async () => [existingExercise],
    isConflict: (error) => error === conflict,
  });

  assert.equal(result, existingExercise);
});

test("does not alter a draft when creation fails", async () => {
  const draft = [{ exercise: { id: "squat", name: "Back Squat", scope: "SYSTEM" as const } }];
  const before = structuredClone(draft);

  await assert.rejects(
    createOrResolveExercise({
      name: "Cossack Squat",
      create: async () => { throw new Error("offline"); },
      search: async () => [],
      isConflict: () => false,
    }),
    /offline/,
  );

  assert.deepEqual(draft, before);
});

test("reports an unresolved collision without creating a draft exercise", async () => {
  const conflict = new Error("conflict");
  await assert.rejects(
    createOrResolveExercise({
      name: "Cossack Squat",
      create: async () => { throw conflict; },
      search: async () => [],
      isConflict: (error) => error === conflict,
    }),
    ExistingExerciseUnavailableError,
  );
});
