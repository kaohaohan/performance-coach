export type DuplicateRequestFailure = {
  workoutId: string;
  message: string;
  isDuplicateConflict: boolean;
};

export function createDuplicateInFlightGuard() {
  let inFlight = false;
  return {
    get inFlight(): boolean {
      return inFlight;
    },
    start(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    finish(): void {
      inFlight = false;
    },
  };
}

export function duplicateSourceEndpoint(sourceDate: string, athleteId: string): string {
  return `/api/v1/scheduled-workouts?from=${sourceDate}&to=${sourceDate}&athleteId=${encodeURIComponent(athleteId)}`;
}

export async function submitDuplicateRequests({
  workoutIds,
  athleteIds,
  targetDate,
  allowDuplicates,
  schedule,
  errorMessage,
  isDuplicateConflict,
}: {
  workoutIds: string[];
  athleteIds: string[];
  targetDate: string;
  allowDuplicates: boolean;
  schedule: (body: { workoutId: string; athleteIds: string[]; scheduledDate: string; allowDuplicates?: true }) => Promise<void>;
  errorMessage: (error: unknown) => string;
  isDuplicateConflict: (error: unknown) => boolean;
}): Promise<DuplicateRequestFailure[]> {
  const failures: DuplicateRequestFailure[] = [];
  for (const workoutId of workoutIds) {
    try {
      await schedule({ workoutId, athleteIds, scheduledDate: targetDate, ...(allowDuplicates ? { allowDuplicates: true } : {}) });
    } catch (error) {
      failures.push({ workoutId, message: errorMessage(error), isDuplicateConflict: isDuplicateConflict(error) });
    }
  }
  return failures;
}
