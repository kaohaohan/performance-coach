"use client";

import { useParams } from "next/navigation";
import { ExerciseProgressView } from "@/components/exercise-progress-view";

export default function AthleteExerciseProgressPage() {
  const params = useParams<{ exerciseId: string }>();
  return <ExerciseProgressView mode="athlete" exerciseId={params.exerciseId} />;
}
