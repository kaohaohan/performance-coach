export type EditableSetLog = { load?: number; unit?: "kg" | "lb"; reps: number; rpe?: number };
export type EditValues = { load: string; unit: "kg" | "lb"; reps: string; rpe: string };

export function editValuesForLog(log: EditableSetLog): EditValues {
  return { load: log.load === undefined ? "" : String(log.load), unit: log.unit ?? "kg", reps: String(log.reps), rpe: log.rpe === undefined ? "" : String(log.rpe) };
}

export function editPayload(values: EditValues): Record<string, unknown> | { error: "reps" | "load" | "rpe" } {
  const reps = Number(values.reps);
  if (!values.reps.trim() || !Number.isInteger(reps) || reps < 1) return { error: "reps" };
  let load: number | undefined;
  if (values.load.trim()) { load = Number(values.load); if (!Number.isFinite(load) || load < 0) return { error: "load" }; }
  let rpe: number | undefined;
  if (values.rpe.trim()) { rpe = Number(values.rpe); if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) return { error: "rpe" }; }
  return { reps, load: load === undefined ? null : load, unit: load === undefined ? null : values.unit, rpe: rpe === undefined ? null : rpe };
}
