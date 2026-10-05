"use client";

import { useParams } from "next/navigation";
import { ExerciseProgressView } from "@/components/exercise-progress-view";

export default function CoachExerciseProgressPage() {
  const params = useParams<{ athleteId: string; exerciseId: string }>();
  return <ExerciseProgressView mode="coach" athleteId={params.athleteId} exerciseId={params.exerciseId} />;
}
