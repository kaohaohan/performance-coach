export type HistoryRange = "7" | "30" | "90" | "all";

export type HistorySession = { id: string; status: "ACTIVE" | "COMPLETED" };

export type HistoryEntry = {
  id: string;
  scheduledDate: string;
  athlete: { id: string; name: string };
  workout: { id: string; name: string };
  session: HistorySession | null;
};

export type HistoryGroup = { date: string; entries: HistoryEntry[] };

export function localISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function historyDateRange(range: HistoryRange, today: Date): { from: string; to: string } {
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range === "all") return { from: "0001-01-01", to: localISODate(localToday) };

  const inclusiveDays = Number(range);
  const from = new Date(localToday.getFullYear(), localToday.getMonth(), localToday.getDate() - (inclusiveDays - 1));
  return { from: localISODate(from), to: localISODate(localToday) };
}

export function historyEndpoint(range: HistoryRange, today: Date, athleteId: string): string {
  const dates = historyDateRange(range, today);
  const params = new URLSearchParams({ from: dates.from, to: dates.to });
  if (athleteId !== "") params.set("athleteId", athleteId);
  return `/api/v1/scheduled-workouts?${params.toString()}`;
}

export function prepareHistory(entries: HistoryEntry[], today: Date): HistoryEntry[] {
  const todayISO = localISODate(today);
  return entries
    .filter((entry) => entry.scheduledDate <= todayISO)
    .sort((left, right) =>
      right.scheduledDate.localeCompare(left.scheduledDate)
      || left.athlete.name.localeCompare(right.athlete.name)
      || left.workout.name.localeCompare(right.workout.name)
      || left.id.localeCompare(right.id),
    );
}

export function groupHistory(entries: HistoryEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const entry of entries) {
    const current = groups.at(-1);
    if (current?.date === entry.scheduledDate) current.entries.push(entry);
    else groups.push({ date: entry.scheduledDate, entries: [entry] });
  }
  return groups;
}

export function historyStatusLabel(session: HistorySession | null): "Not started" | "In progress" | "Done" {
  if (session?.status === "COMPLETED") return "Done";
  if (session?.status === "ACTIVE") return "In progress";
  return "Not started";
}
