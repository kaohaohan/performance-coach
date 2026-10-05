export type EditableSetLog = { load?: number; unit?: "kg" | "lb"; reps: number; rir?: number };
export type EditValues = { load: string; unit: "kg" | "lb"; reps: string; rir: string };

export function editValuesForLog(log: EditableSetLog): EditValues {
  return { load: log.load === undefined ? "" : String(log.load), unit: log.unit ?? "kg", reps: String(log.reps), rir: log.rir === undefined ? "" : String(log.rir) };
}

export function editPayload(values: EditValues): Record<string, unknown> | { error: "reps" | "load" | "rir" } {
  const reps = Number(values.reps);
  if (!values.reps.trim() || !Number.isInteger(reps) || reps < 1) return { error: "reps" };
  let load: number | undefined;
  if (values.load.trim()) { load = Number(values.load); if (!Number.isFinite(load) || load < 0) return { error: "load" }; }
  let rir: number | undefined;
  if (values.rir.trim()) { rir = Number(values.rir); if (!Number.isFinite(rir) || rir < 0 || rir > 9) return { error: "rir" }; }
  return { reps, load: load === undefined ? null : load, unit: load === undefined ? null : values.unit, rir: rir === undefined ? null : rir };
}
