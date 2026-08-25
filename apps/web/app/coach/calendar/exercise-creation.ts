import type { Exercise } from "./workout-draft";

export class ExistingExerciseUnavailableError extends Error {
  constructor() {
    super("The existing exercise is not available to add.");
    this.name = "ExistingExerciseUnavailableError";
  }
}

export async function createOrResolveExercise({
  name,
  create,
  search,
  isConflict,
}: {
  name: string;
  create: () => Promise<Exercise>;
  search: () => Promise<Exercise[]>;
  isConflict: (error: unknown) => boolean;
}): Promise<Exercise> {
  try {
    return await create();
  } catch (error) {
    if (!isConflict(error)) throw error;
    const existingExercise = (await search()).find(
      (exercise) => exercise.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
    );
    if (existingExercise === undefined) throw new ExistingExerciseUnavailableError();
    return existingExercise;
  }
}
